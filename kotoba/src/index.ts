/**
 * air-yield kotoba — barrel. kotoba-E2E split (ADR-2605181100):
 *   PLAINTEXT (fareClass / inventoryControl / demandForecast) — public fare
 *   catalog + operational availability + aggregate forecasts.
 *   E2E (groupBooking / pricingDecision / revenueReport) — PII + confidential
 *   commercial terms + ledger financials sealed in the kotoba envelope.
 *   STAYS etzhayyim (consent-capability): IATA BSP fiat-clearing settlement EXECUTION
 *   + GPU/LLM forecast/pricing model INFERENCE.
 */
export * from "./types.js";
export {
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
} from "./registry.js";
