import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  publishFareClass,
  getFareClass,
  listFareClasses,
  adjustInventory,
  listInventory,
  forecastDemand,
  listForecasts,
  processGroupBooking,
  getGroupBooking,
  applyDynamicPrice,
  generateRevenueReport,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:air-yield.etzhayyim.com";

describe("air-yield kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("fareClass (PLAINTEXT public catalog) — publishFareClass + fileFare", () => {
    it("publishes, dedups, validates, gets, lists/filters", async () => {
      const ok = await publishFareClass(e, { fareClassId: "fc1", flight: "GA101", cabin: "economy", bookingClass: "Y", fareBasis: "YOWAB", fareAmount: "499.00" });
      expect(ok.status).toBe("published");
      expect((await publishFareClass(e, { fareClassId: "fc1", flight: "GA101", cabin: "economy", bookingClass: "Y", fareBasis: "YOWAB", fareAmount: "499.00" })).status).toBe("alreadyExists");
      // float-as-string guard: bad decimal rejected
      expect((await publishFareClass(e, { fareClassId: "fcX", flight: "X", cabin: "y", bookingClass: "Q", fareBasis: "QB", fareAmount: "1.2.3" })).status).toBe("rejected");
      await publishFareClass(e, { fareClassId: "fc2", flight: "GA202", cabin: "business", bookingClass: "J", fareBasis: "JFLEX", fareAmount: "1899.50" });
      const got = await getFareClass(e, { fareClassId: "fc1" });
      expect(got.fareClass?.fareBasis).toBe("YOWAB");
      expect((await listFareClasses(e)).total).toBe(2);
      expect((await listFareClasses(e, { flight: "GA101" })).total).toBe(1);
    });
  });

  describe("inventoryControl (PLAINTEXT) — adjustInventory + setOverbooking + FK", () => {
    it("enforces FK → fareClass, validates ints, lists/filters", async () => {
      // FK fails before a fare class exists
      expect((await adjustInventory(e, { inventoryId: "i1", fareClassId: "missing", flight: "GA101", bookingClass: "Y", authorizationUnits: 30 })).status).toBe("rejected");
      await publishFareClass(e, { fareClassId: "fc1", flight: "GA101", cabin: "economy", bookingClass: "Y", fareBasis: "YOWAB", fareAmount: "499.00" });
      const ok = await adjustInventory(e, { inventoryId: "i1", fareClassId: "fc1", flight: "GA101", bookingClass: "Y", authorizationUnits: 30, seatsSold: 12, overbookingPermille: 1100 });
      expect(ok.status).toBe("adjusted");
      // negative AU rejected (no float / no negative)
      expect((await adjustInventory(e, { inventoryId: "iX", fareClassId: "fc1", flight: "GA101", bookingClass: "Y", authorizationUnits: -5 })).status).toBe("rejected");
      await publishFareClass(e, { fareClassId: "fc2", flight: "GA202", cabin: "business", bookingClass: "J", fareBasis: "JFLEX", fareAmount: "1899.50" });
      await adjustInventory(e, { inventoryId: "i2", fareClassId: "fc2", flight: "GA202", bookingClass: "J", authorizationUnits: 8 });
      expect((await listInventory(e)).total).toBe(2);
      expect((await listInventory(e, { flight: "GA101" })).total).toBe(1);
    });
  });

  describe("demandForecast (PLAINTEXT aggregate) — forecastDemand", () => {
    it("records, dedups, validates percent 0-100, lists/filters", async () => {
      expect((await forecastDemand(e, { forecastId: "d1", route: "CGK-SIN", departureDate: "2026-07-01", estimatedBookings: 142, loadFactorPct: 88 })).status).toBe("recorded");
      expect((await forecastDemand(e, { forecastId: "d1", route: "CGK-SIN", departureDate: "2026-07-01", estimatedBookings: 142, loadFactorPct: 88 })).status).toBe("alreadyExists");
      // loadFactorPct > 100 rejected
      expect((await forecastDemand(e, { forecastId: "dX", route: "X", departureDate: "2026-07-01", estimatedBookings: 1, loadFactorPct: 120 })).status).toBe("rejected");
      await forecastDemand(e, { forecastId: "d2", route: "CGK-DPS", departureDate: "2026-07-02", estimatedBookings: 90, loadFactorPct: 70 });
      expect((await listForecasts(e)).total).toBe(2);
      expect((await listForecasts(e, { route: "CGK-SIN" })).total).toBe(1);
    });
  });

  describe("groupBooking (E2E PII + confidential terms) — processGroupBooking", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates", async () => {
      const ok = await processGroupBooking(e, { groupBookingId: "g1", agencyDid: "did:web:agency.example", contactName: "Maria Santos", flight: "GA101", cabin: "economy", seats: 24, negotiatedFare: "389.00" });
      expect(ok.status).toBe("processed");
      expect(ok.keyId).toBeTruthy();
      // bad decimal negotiated fare rejected
      expect((await processGroupBooking(e, { groupBookingId: "gX", agencyDid: "d", contactName: "n", flight: "f", cabin: "c", seats: 1, negotiatedFare: "abc" })).status).toBe("rejected");
      const got = await getGroupBooking(e, { groupBookingId: "g1" });
      expect(got.groupBooking?.contactName).toBe("Maria Santos");
      expect(got.groupBooking?.negotiatedFare).toBe("389.00");
    });

    it("enforces read-cap: a non-recipient DID cannot read the booking", async () => {
      await processGroupBooking(e, { groupBookingId: "g1", agencyDid: "did:web:agency", contactName: "X", flight: "GA101", cabin: "economy", seats: 10, negotiatedFare: "389.00" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      // distinct PDS view → no read-cap, sees nothing
      expect((await getGroupBooking(outsider, { groupBookingId: "g1" })).error).toBe("notFound");
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await processGroupBooking(e, { groupBookingId: "g1", agencyDid: "did:web:agency", contactName: "X", flight: "GA101", cabin: "economy", seats: 10, negotiatedFare: "389.00", recipients: [partner] });
      expect(r.status).toBe("processed");
      expect((await getGroupBooking(e, { groupBookingId: "g1" })).groupBooking?.seats).toBe(10);
    });
  });

  describe("pricingDecision (E2E confidential) — applyDynamicPrice", () => {
    it("seals confidential pricing, validates pct fields", async () => {
      const ok = await applyDynamicPrice(e, { decisionId: "pd1", flight: "GA101", bookingClass: "Y", newFare: "549.00", competitorIndex: 9800, wtpTier: 70, marginPct: 22 });
      expect(ok.status).toBe("applied");
      expect(ok.keyId).toBeTruthy();
      // marginPct > 100 rejected
      expect((await applyDynamicPrice(e, { decisionId: "pdX", flight: "f", bookingClass: "Y", newFare: "1.00", competitorIndex: 1, wtpTier: 50, marginPct: 200 })).status).toBe("rejected");
    });
  });

  describe("revenueReport (E2E confidential ledger) — generateRevenueReport", () => {
    it("seals ledger financials, validates decimals", async () => {
      const ok = await generateRevenueReport(e, { reportId: "r1", route: "CGK-SIN", periodStart: "2026-06-01", periodEnd: "2026-06-30", totalRevenue: "1284500.75", passengers: 4210, rask: "0.082" });
      expect(ok.status).toBe("generated");
      expect(ok.keyId).toBeTruthy();
      // bad RASK decimal rejected
      expect((await generateRevenueReport(e, { reportId: "rX", route: "X", periodStart: "a", periodEnd: "b", totalRevenue: "1.00", passengers: 1, rask: "1,2" })).status).toBe("rejected");
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext + E2E across all six collections", async () => {
      await publishFareClass(e, { fareClassId: "fc1", flight: "GA101", cabin: "economy", bookingClass: "Y", fareBasis: "YOWAB", fareAmount: "499.00" });
      await publishFareClass(e, { fareClassId: "fc2", flight: "GA101", cabin: "economy", bookingClass: "B", fareBasis: "BOWAB", fareAmount: "599.00" });
      await adjustInventory(e, { inventoryId: "i1", fareClassId: "fc1", flight: "GA101", bookingClass: "Y", authorizationUnits: 30 });
      await forecastDemand(e, { forecastId: "d1", route: "CGK-SIN", departureDate: "2026-07-01", estimatedBookings: 100, loadFactorPct: 80 });
      await processGroupBooking(e, { groupBookingId: "g1", agencyDid: "did:web:a", contactName: "N", flight: "GA101", cabin: "economy", seats: 10, negotiatedFare: "389.00" });
      await applyDynamicPrice(e, { decisionId: "pd1", flight: "GA101", bookingClass: "Y", newFare: "549.00", competitorIndex: 9800, wtpTier: 70, marginPct: 22 });
      await generateRevenueReport(e, { reportId: "rr1", route: "CGK-SIN", periodStart: "2026-06-01", periodEnd: "2026-06-30", totalRevenue: "1000.00", passengers: 50, rask: "0.08" });

      const cov = await coverage(e);
      expect(cov.fareClassCount).toBe(2);
      expect(cov.inventoryControlCount).toBe(1);
      expect(cov.demandForecastCount).toBe(1);
      expect(cov.groupBookingCount).toBe(1);
      expect(cov.pricingDecisionCount).toBe(1);
      expect(cov.revenueReportCount).toBe(1);
      expect(cov.fareClassesByFlight?.GA101).toBe(2);
      expect(cov.truncated).toBe(false);
    });
  });
});
