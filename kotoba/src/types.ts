/**
 * air-yield kotoba — kotoba-E2E split for airline revenue management & pricing.
 *
 * Per ADR-2606011400 (Consensys) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / confidential commercial terms may migrate to etzhayyim when made safe
 * via kotoba E2E. MAXIMAL migration — front everything that can move.
 *
 * Source app = 8 methods: publishFareClass / adjustInventory / fileFare /
 * setOverbooking / processGroupBooking / applyDynamicPrice /
 * generateRevenueReport / forecastDemand.
 *
 * SPLIT (discriminator: a field is E2E if it carries a customer/agency identity,
 * a confidential commercial term/margin, or per-route financial results; pure
 * published reference + operational availability facts are plaintext):
 *
 *   PUBLIC (plaintext AT records) — published reference + operational anchors
 *   with NO party identity & no confidential margin:
 *     - `fareClass` (publishFareClass + fileFare): published/filed fare classes
 *       (flight, cabin, fareBasis, bookingClass, public fare amount as decimal
 *       string, status). A public fare catalog.
 *     - `inventoryControl` (adjustInventory + setOverbooking): seat availability,
 *       authorization units, nesting + overbooking factor per flight/class.
 *       Operational facts; FK inventoryControl → fareClass via exists().
 *     - `demandForecast` (forecastDemand): aggregate route/flight demand estimate
 *       (no subject identity). Frontable open metadata + aggregate stats.
 *
 *   SENSITIVE (kotoba E2E, com.etzhayyim.encrypted.record) — written via
 *   sdk.encryptedWrite (read-cap = owner DID + explicit recipients); the
 *   substrate never sees these in plaintext:
 *     - `groupBooking` (processGroupBooking): corporate/agency group booking —
 *       agency DID + contact name + negotiated confidential fare = PII +
 *       confidential commercial terms.
 *     - `pricingDecision` (applyDynamicPrice): confidential dynamic-pricing
 *       decision (competitor index, willingness-to-pay tier, margin) =
 *       commercial-sensitive.
 *     - `revenueReport` (generateRevenueReport): per-route revenue / RASK /
 *       ledger-entry financials = confidential commercial ledger. (Per Operating
 *       Entity Boundary ADR-2605172100 the LEDGER DATA migrates as E2E records;
 *       only the fiat-clearing settlement CALL stays etzhayyim — see below.)
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection) —
 *     - IATA BSP fiat-clearing settlement EXECUTION: the actual fare/ticket money
 *       movement / merchant-of-record rail. etzhayyim never becomes the fiat MoR
 *       (on-chain USDC only), so the settlement CALL stays etzhayyim while the ledger
 *       DATA fronts E2E.
 *     - GPU/LLM demand-forecast & willingness-to-pay model INFERENCE execution
 *       (the compute that produces forecasts/pricing); only the resulting
 *       estimate records front.
 *
 * AT-Lexicon: no float — money/decimals are decimal STRINGS; counts/AU are
 * integers; factors/percent are integer 0-... or 0-100 (loadFactorPct).
 */

// ─── Plaintext public collections ───────────────────────────────────
export const FARE_CLASS_COLLECTION = "com.etzhayyim.apps.airYield.fareClass";
export const INVENTORY_CONTROL_COLLECTION = "com.etzhayyim.apps.airYield.inventoryControl";
export const DEMAND_FORECAST_COLLECTION = "com.etzhayyim.apps.airYield.demandForecast";

// ─── E2E inner-type NSIDs (body shape inside the encrypted envelope) ──
export const GROUP_BOOKING_INNER_TYPE = "com.etzhayyim.apps.airYield.groupBooking";
export const PRICING_DECISION_INNER_TYPE = "com.etzhayyim.apps.airYield.pricingDecision";
export const REVENUE_REPORT_INNER_TYPE = "com.etzhayyim.apps.airYield.revenueReport";

export const AIR_YIELD_DID_PREFIX = "did:web:air-yield.etzhayyim.com:" as const;

// ─── Fare class (PLAINTEXT, public reference catalog) ────────────────

export interface FareClassRecord {
  did: string;
  fareClassId: string;
  flight: string;
  cabin: string;
  /** Booking/RBD letter (e.g. Y, B, Q). */
  bookingClass: string;
  fareBasis: string;
  /** Decimal published fare amount as string (no float). */
  fareAmount: string;
  currency: string;
  /** "published" | "filed" | "withdrawn". */
  status: string;
  createdAt: string;
}
export interface FareClassView extends FareClassRecord {
  fareClassUri: string;
}
export interface PublishFareClassInput {
  fareClassId: string;
  flight: string;
  cabin: string;
  bookingClass: string;
  fareBasis: string;
  fareAmount: string;
  currency?: string;
  status?: string;
}
export interface PublishFareClassOutput {
  status: "published" | "alreadyExists" | "rejected";
  fareClassUri?: string;
  did?: string;
  fareClassId?: string;
  error?: string;
}
export interface GetFareClassInput {
  fareClassId: string;
}
export interface GetFareClassOutput {
  fareClass?: FareClassView;
  error?: string;
}
export interface ListFareClassesInput {
  flight?: string;
  limit?: number;
  cursor?: string;
}
export interface ListFareClassesOutput {
  items: FareClassView[];
  cursor?: string;
  total: number;
}

// ─── Inventory control (PLAINTEXT, operational; FK → fareClass) ──────

export interface InventoryControlRecord {
  did: string;
  inventoryId: string;
  /** FK → fareClass.fareClassId (exists() check). */
  fareClassId: string;
  flight: string;
  bookingClass: string;
  /** Authorization units (seats available to sell), integer. */
  authorizationUnits: number;
  /** Seats physically sold, integer. */
  seatsSold: number;
  /** Overbooking factor in permille (1000 = 100%), integer. */
  overbookingPermille: number;
  createdAt: string;
}
export interface InventoryControlView extends InventoryControlRecord {
  inventoryUri: string;
}
export interface AdjustInventoryInput {
  inventoryId: string;
  fareClassId: string;
  flight: string;
  bookingClass: string;
  authorizationUnits: number;
  seatsSold?: number;
  /** Default 1000 (100%, no overbooking). */
  overbookingPermille?: number;
}
export interface AdjustInventoryOutput {
  status: "adjusted" | "rejected";
  inventoryUri?: string;
  did?: string;
  inventoryId?: string;
  error?: string;
}
export interface ListInventoryInput {
  flight?: string;
  limit?: number;
  cursor?: string;
}
export interface ListInventoryOutput {
  items: InventoryControlView[];
  cursor?: string;
  total: number;
}

// ─── Demand forecast (PLAINTEXT, aggregate; no subject identity) ─────

export interface DemandForecastRecord {
  did: string;
  forecastId: string;
  route: string;
  flight?: string;
  departureDate: string;
  /** Estimated bookings (aggregate), integer. */
  estimatedBookings: number;
  /** Estimated load factor, integer percent 0-100. */
  loadFactorPct: number;
  generatedAt: string;
  createdAt: string;
}
export interface DemandForecastView extends DemandForecastRecord {
  forecastUri: string;
}
export interface ForecastDemandInput {
  forecastId: string;
  route: string;
  flight?: string;
  departureDate: string;
  estimatedBookings: number;
  loadFactorPct: number;
  generatedAt?: string;
}
export interface ForecastDemandOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  forecastUri?: string;
  did?: string;
  forecastId?: string;
  error?: string;
}
export interface ListForecastsInput {
  route?: string;
  limit?: number;
  cursor?: string;
}
export interface ListForecastsOutput {
  items: DemandForecastView[];
  cursor?: string;
  total: number;
}

// ─── Group booking (E2E, PII + confidential commercial terms) ───────

export interface GroupBookingBody {
  groupBookingId: string;
  /** Agency / corporate counterparty DID (PII). */
  agencyDid: string;
  contactName: string;
  flight: string;
  cabin: string;
  /** Seats requested, integer. */
  seats: number;
  /** Negotiated confidential per-seat fare, decimal string (no float). */
  negotiatedFare: string;
  currency: string;
  /** "requested" | "confirmed" | "declined". */
  status: string;
  requestedAt: string;
}
export interface GroupBookingView extends GroupBookingBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface ProcessGroupBookingInput {
  groupBookingId: string;
  agencyDid: string;
  contactName: string;
  flight: string;
  cabin: string;
  seats: number;
  negotiatedFare: string;
  currency?: string;
  status?: string;
  requestedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface ProcessGroupBookingOutput {
  status: "processed" | "rejected";
  uri?: string;
  keyId?: string;
  groupBookingId?: string;
  error?: string;
}
export interface GetGroupBookingInput {
  groupBookingId: string;
}
export interface GetGroupBookingOutput {
  groupBooking?: GroupBookingView;
  error?: string;
}

// ─── Pricing decision (E2E, confidential dynamic-pricing) ───────────

export interface PricingDecisionBody {
  decisionId: string;
  flight: string;
  bookingClass: string;
  /** New fare after dynamic adjustment, decimal string. */
  newFare: string;
  currency: string;
  /** Competitor price index, integer (basis points relative, 10000 = parity). */
  competitorIndex: number;
  /** Willingness-to-pay tier, integer 0-100. */
  wtpTier: number;
  /** Projected margin, integer percent 0-100. */
  marginPct: number;
  decidedAt: string;
}
export interface PricingDecisionView extends PricingDecisionBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface ApplyDynamicPriceInput {
  decisionId: string;
  flight: string;
  bookingClass: string;
  newFare: string;
  currency?: string;
  competitorIndex: number;
  wtpTier: number;
  marginPct: number;
  decidedAt?: string;
  recipients?: string[];
}
export interface ApplyDynamicPriceOutput {
  status: "applied" | "rejected";
  uri?: string;
  keyId?: string;
  decisionId?: string;
  error?: string;
}

// ─── Revenue report (E2E, confidential commercial ledger) ───────────

export interface RevenueReportBody {
  reportId: string;
  route: string;
  periodStart: string;
  periodEnd: string;
  /** Total revenue for the period, decimal string. */
  totalRevenue: string;
  currency: string;
  /** Passengers carried, integer. */
  passengers: number;
  /** Revenue per available seat km (RASK), decimal string. */
  rask: string;
  generatedAt: string;
}
export interface RevenueReportView extends RevenueReportBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface GenerateRevenueReportInput {
  reportId: string;
  route: string;
  periodStart: string;
  periodEnd: string;
  totalRevenue: string;
  currency?: string;
  passengers: number;
  rask: string;
  generatedAt?: string;
  recipients?: string[];
}
export interface GenerateRevenueReportOutput {
  status: "generated" | "rejected";
  uri?: string;
  keyId?: string;
  reportId?: string;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  fareClassCount?: number;
  inventoryControlCount?: number;
  demandForecastCount?: number;
  groupBookingCount?: number;
  pricingDecisionCount?: number;
  revenueReportCount?: number;
  fareClassesByFlight?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isPct(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;
}
/** Non-negative decimal string, e.g. "1234.56". No float in records. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function fareClassDidFor(id: string): string {
  return `${AIR_YIELD_DID_PREFIX}fc:${id.toLowerCase()}`;
}
export function inventoryDidFor(id: string): string {
  return `${AIR_YIELD_DID_PREFIX}inv:${id.toLowerCase()}`;
}
export function forecastDidFor(id: string): string {
  return `${AIR_YIELD_DID_PREFIX}fcst:${id.toLowerCase()}`;
}
function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function fareClassRkey(id: string): string {
  return `fc-${slug(id)}`;
}
export function inventoryRkey(id: string): string {
  return `inv-${slug(id)}`;
}
export function forecastRkey(id: string): string {
  return `fcst-${slug(id)}`;
}
export function groupBookingRkey(id: string): string {
  return `grp-${slug(id)}`;
}
export function pricingDecisionRkey(id: string): string {
  return `pd-${slug(id)}`;
}
export function revenueReportRkey(id: string): string {
  return `rev-${slug(id)}`;
}
