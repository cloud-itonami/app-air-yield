/**
 * air-yield kotoba — registry. kotoba-E2E split (ADR-2605181100).
 *
 * Plaintext path (fareClass / inventoryControl / demandForecast):
 *   sdk.write / sdk.read — public fare catalog, operational availability, and
 *   aggregate demand forecasts. FK inventoryControl → fareClass via exists().
 * E2E path (groupBooking / pricingDecision / revenueReport):
 *   sdk.encryptedWrite / sdk.encryptedRead — PII + confidential commercial terms
 *   + per-route ledger financials sealed in the kotoba envelope, read-cap =
 *   owner DID + explicit recipients. The substrate never sees these in plaintext.
 *
 * STAYS etzhayyim (consumed via consent-capability): IATA BSP fiat-clearing
 * settlement EXECUTION and GPU/LLM forecast/pricing model INFERENCE.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  FARE_CLASS_COLLECTION,
  INVENTORY_CONTROL_COLLECTION,
  DEMAND_FORECAST_COLLECTION,
  GROUP_BOOKING_INNER_TYPE,
  PRICING_DECISION_INNER_TYPE,
  REVENUE_REPORT_INNER_TYPE,
  fareClassDidFor,
  inventoryDidFor,
  forecastDidFor,
  fareClassRkey,
  inventoryRkey,
  forecastRkey,
  groupBookingRkey,
  pricingDecisionRkey,
  revenueReportRkey,
  isUint,
  isPct,
  isDecimalString,
  type AdjustInventoryInput,
  type AdjustInventoryOutput,
  type ApplyDynamicPriceInput,
  type ApplyDynamicPriceOutput,
  type CoverageInput,
  type CoverageOutput,
  type DemandForecastRecord,
  type DemandForecastView,
  type FareClassRecord,
  type FareClassView,
  type ForecastDemandInput,
  type ForecastDemandOutput,
  type GenerateRevenueReportInput,
  type GenerateRevenueReportOutput,
  type GetFareClassInput,
  type GetFareClassOutput,
  type GetGroupBookingInput,
  type GetGroupBookingOutput,
  type GroupBookingBody,
  type GroupBookingView,
  type InventoryControlRecord,
  type InventoryControlView,
  type ListFareClassesInput,
  type ListFareClassesOutput,
  type ListForecastsInput,
  type ListForecastsOutput,
  type ListInventoryInput,
  type ListInventoryOutput,
  type PricingDecisionBody,
  type ProcessGroupBookingInput,
  type ProcessGroupBookingOutput,
  type PublishFareClassInput,
  type PublishFareClassOutput,
  type RevenueReportBody,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function fareClassExists(e: Etzhayyim, fareClassId: string): Promise<boolean> {
  const resp = await e
    .read<FareClassRecord>({ collection: FARE_CLASS_COLLECTION, rkey: fareClassRkey(fareClassId) })
    .catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

// ─── Fare class (PLAINTEXT) — publishFareClass + fileFare ───────────

export async function publishFareClass(e: Etzhayyim, input: PublishFareClassInput): Promise<PublishFareClassOutput> {
  if (!input.fareClassId || !input.flight || !input.cabin || !input.bookingClass || !input.fareBasis) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isDecimalString(input.fareAmount)) return { status: "rejected", error: "invalidFareAmount" };
  const rkey = fareClassRkey(input.fareClassId);
  const existing = await e
    .read<FareClassRecord>({ collection: FARE_CLASS_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", fareClassUri: existing.records[0].uri, did: existing.records[0].value.did, fareClassId: input.fareClassId };
  }
  const now = new Date().toISOString();
  const did = fareClassDidFor(input.fareClassId);
  const record: FareClassRecord = {
    did,
    fareClassId: input.fareClassId,
    flight: input.flight,
    cabin: input.cabin,
    bookingClass: input.bookingClass,
    fareBasis: input.fareBasis,
    fareAmount: input.fareAmount,
    currency: input.currency ?? "USD",
    status: input.status ?? "published",
    createdAt: now,
  };
  const receipt = await e.write({ collection: FARE_CLASS_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "published", fareClassUri: receipt.uri, did, fareClassId: input.fareClassId };
}

export async function getFareClass(e: Etzhayyim, input: GetFareClassInput): Promise<GetFareClassOutput> {
  if (!input.fareClassId) return { error: "invalidFareClassId" };
  const resp = await e
    .read<FareClassRecord>({ collection: FARE_CLASS_COLLECTION, rkey: fareClassRkey(input.fareClassId) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { fareClass: { ...r.value, fareClassUri: r.uri } };
}

export async function listFareClasses(e: Etzhayyim, input: ListFareClassesInput = {}): Promise<ListFareClassesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<FareClassRecord>({ collection: FARE_CLASS_COLLECTION, cursor: input.cursor, limit });
  const items: FareClassView[] = resp.records
    .filter((r) => !input.flight || r.value.flight === input.flight)
    .map((r) => ({ ...r.value, fareClassUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Inventory control (PLAINTEXT) — adjustInventory + setOverbooking ─

export async function adjustInventory(e: Etzhayyim, input: AdjustInventoryInput): Promise<AdjustInventoryOutput> {
  if (!input.inventoryId || !input.fareClassId || !input.flight || !input.bookingClass) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isUint(input.authorizationUnits)) return { status: "rejected", error: "invalidAuthorizationUnits" };
  const seatsSold = input.seatsSold ?? 0;
  if (!isUint(seatsSold)) return { status: "rejected", error: "invalidSeatsSold" };
  const overbookingPermille = input.overbookingPermille ?? 1000;
  if (!isUint(overbookingPermille)) return { status: "rejected", error: "invalidOverbookingPermille" };
  if (!(await fareClassExists(e, input.fareClassId))) return { status: "rejected", error: "unknownFareClass" };
  const now = new Date().toISOString();
  const did = inventoryDidFor(input.inventoryId);
  const record: InventoryControlRecord = {
    did,
    inventoryId: input.inventoryId,
    fareClassId: input.fareClassId,
    flight: input.flight,
    bookingClass: input.bookingClass,
    authorizationUnits: input.authorizationUnits,
    seatsSold,
    overbookingPermille,
    createdAt: now,
  };
  const receipt = await e.write({ collection: INVENTORY_CONTROL_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: inventoryRkey(input.inventoryId) });
  return { status: "adjusted", inventoryUri: receipt.uri, did, inventoryId: input.inventoryId };
}

export async function listInventory(e: Etzhayyim, input: ListInventoryInput = {}): Promise<ListInventoryOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<InventoryControlRecord>({ collection: INVENTORY_CONTROL_COLLECTION, cursor: input.cursor, limit });
  const items: InventoryControlView[] = resp.records
    .filter((r) => !input.flight || r.value.flight === input.flight)
    .map((r) => ({ ...r.value, inventoryUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Demand forecast (PLAINTEXT) — forecastDemand ───────────────────

export async function forecastDemand(e: Etzhayyim, input: ForecastDemandInput): Promise<ForecastDemandOutput> {
  if (!input.forecastId || !input.route || !input.departureDate) return { status: "rejected", error: "missingRequiredFields" };
  if (!isUint(input.estimatedBookings)) return { status: "rejected", error: "invalidEstimatedBookings" };
  if (!isPct(input.loadFactorPct)) return { status: "rejected", error: "invalidLoadFactorPct" };
  const rkey = forecastRkey(input.forecastId);
  const existing = await e
    .read<DemandForecastRecord>({ collection: DEMAND_FORECAST_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", forecastUri: existing.records[0].uri, did: existing.records[0].value.did, forecastId: input.forecastId };
  }
  const now = new Date().toISOString();
  const did = forecastDidFor(input.forecastId);
  const record: DemandForecastRecord = {
    did,
    forecastId: input.forecastId,
    route: input.route,
    flight: input.flight,
    departureDate: input.departureDate,
    estimatedBookings: input.estimatedBookings,
    loadFactorPct: input.loadFactorPct,
    generatedAt: input.generatedAt ?? now,
    createdAt: now,
  };
  const receipt = await e.write({ collection: DEMAND_FORECAST_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", forecastUri: receipt.uri, did, forecastId: input.forecastId };
}

export async function listForecasts(e: Etzhayyim, input: ListForecastsInput = {}): Promise<ListForecastsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<DemandForecastRecord>({ collection: DEMAND_FORECAST_COLLECTION, cursor: input.cursor, limit });
  const items: DemandForecastView[] = resp.records
    .filter((r) => !input.route || r.value.route === input.route)
    .map((r) => ({ ...r.value, forecastUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Group booking (E2E) — processGroupBooking ──────────────────────

export async function processGroupBooking(e: Etzhayyim, input: ProcessGroupBookingInput): Promise<ProcessGroupBookingOutput> {
  if (!input.groupBookingId || !input.agencyDid || !input.contactName || !input.flight || !input.cabin) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isUint(input.seats)) return { status: "rejected", error: "invalidSeats" };
  if (!isDecimalString(input.negotiatedFare)) return { status: "rejected", error: "invalidNegotiatedFare" };
  const body: GroupBookingBody = {
    groupBookingId: input.groupBookingId,
    agencyDid: input.agencyDid,
    contactName: input.contactName,
    flight: input.flight,
    cabin: input.cabin,
    seats: input.seats,
    negotiatedFare: input.negotiatedFare,
    currency: input.currency ?? "USD",
    status: input.status ?? "requested",
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: GROUP_BOOKING_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: groupBookingRkey(input.groupBookingId),
  });
  return { status: "processed", uri: receipt.uri, keyId: receipt.keyId, groupBookingId: input.groupBookingId };
}

async function scanGroupBookings(e: Etzhayyim, maxScan: number): Promise<GroupBookingView[]> {
  const out: GroupBookingView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<GroupBookingBody>({ innerType: GROUP_BOOKING_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getGroupBooking(e: Etzhayyim, input: GetGroupBookingInput): Promise<GetGroupBookingOutput> {
  if (!input.groupBookingId) return { error: "invalidGroupBookingId" };
  const all = await scanGroupBookings(e, DEFAULT_MAX_SCAN);
  const found = all.find((g) => g.groupBookingId === input.groupBookingId);
  if (!found) return { error: "notFound" };
  return { groupBooking: found };
}

// ─── Pricing decision (E2E) — applyDynamicPrice ─────────────────────

export async function applyDynamicPrice(e: Etzhayyim, input: ApplyDynamicPriceInput): Promise<ApplyDynamicPriceOutput> {
  if (!input.decisionId || !input.flight || !input.bookingClass) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.newFare)) return { status: "rejected", error: "invalidNewFare" };
  if (!isUint(input.competitorIndex)) return { status: "rejected", error: "invalidCompetitorIndex" };
  if (!isPct(input.wtpTier)) return { status: "rejected", error: "invalidWtpTier" };
  if (!isPct(input.marginPct)) return { status: "rejected", error: "invalidMarginPct" };
  const body: PricingDecisionBody = {
    decisionId: input.decisionId,
    flight: input.flight,
    bookingClass: input.bookingClass,
    newFare: input.newFare,
    currency: input.currency ?? "USD",
    competitorIndex: input.competitorIndex,
    wtpTier: input.wtpTier,
    marginPct: input.marginPct,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: PRICING_DECISION_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: pricingDecisionRkey(input.decisionId),
  });
  return { status: "applied", uri: receipt.uri, keyId: receipt.keyId, decisionId: input.decisionId };
}

async function scanPricingDecisions(e: Etzhayyim, maxScan: number): Promise<PricingDecisionBody[]> {
  const out: PricingDecisionBody[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<PricingDecisionBody>({ innerType: PRICING_DECISION_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push(r.value);
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Revenue report (E2E) — generateRevenueReport ───────────────────

export async function generateRevenueReport(e: Etzhayyim, input: GenerateRevenueReportInput): Promise<GenerateRevenueReportOutput> {
  if (!input.reportId || !input.route || !input.periodStart || !input.periodEnd) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.totalRevenue)) return { status: "rejected", error: "invalidTotalRevenue" };
  if (!isDecimalString(input.rask)) return { status: "rejected", error: "invalidRask" };
  if (!isUint(input.passengers)) return { status: "rejected", error: "invalidPassengers" };
  const body: RevenueReportBody = {
    reportId: input.reportId,
    route: input.route,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalRevenue: input.totalRevenue,
    currency: input.currency ?? "USD",
    passengers: input.passengers,
    rask: input.rask,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: REVENUE_REPORT_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: revenueReportRkey(input.reportId),
  });
  return { status: "generated", uri: receipt.uri, keyId: receipt.keyId, reportId: input.reportId };
}

async function scanRevenueReports(e: Etzhayyim, maxScan: number): Promise<RevenueReportBody[]> {
  const out: RevenueReportBody[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<RevenueReportBody>({ innerType: REVENUE_REPORT_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push(r.value);
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Coverage rollup (plaintext countAll + E2E countAll) ────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const fareClassesByFlight: Record<string, number> = {};

  let fareClassCount = 0;
  let cursor: string | undefined;
  while (fareClassCount < maxScan) {
    const page = await e.read<FareClassRecord>({ collection: FARE_CLASS_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      fareClassesByFlight[r.value.flight] = (fareClassesByFlight[r.value.flight] ?? 0) + 1;
      fareClassCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }

  const inventoryControlCount = await countAll<InventoryControlRecord>(e, INVENTORY_CONTROL_COLLECTION, maxScan);
  const demandForecastCount = await countAll<DemandForecastRecord>(e, DEMAND_FORECAST_COLLECTION, maxScan);

  const groupBookingCount = (await scanGroupBookings(e, maxScan)).length;
  const pricingDecisionCount = (await scanPricingDecisions(e, maxScan)).length;
  const revenueReportCount = (await scanRevenueReports(e, maxScan)).length;

  return {
    fareClassCount,
    inventoryControlCount,
    demandForecastCount,
    groupBookingCount,
    pricingDecisionCount,
    revenueReportCount,
    fareClassesByFlight,
    truncated:
      fareClassCount >= maxScan ||
      inventoryControlCount >= maxScan ||
      demandForecastCount >= maxScan ||
      groupBookingCount >= maxScan ||
      pricingDecisionCount >= maxScan ||
      revenueReportCount >= maxScan,
  };
}

async function countAll<T>(e: Etzhayyim, collection: string, maxScan: number): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  while (count < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    count += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return count;
}
