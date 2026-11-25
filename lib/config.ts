// Business rules the finance team can tune. Kept in one place on purpose.
export const RULES = {
  /** Auto-approve a price difference only if it is within this % of the PO value... */
  tolerancePct: 1,
  /** ...AND under this many rupees. Whichever is smaller wins. */
  toleranceCapInr: 5000,
  /** Tax math is allowed to be off by this much (rounding). */
  roundingInr: 1,
  /** Vendor creep: this many earlier small overcharges from the same vendor... */
  creepCount: 3,
  /** ...within this many days, flags the next one. */
  creepWindowDays: 120,
};

export function toleranceFor(poAmount: number): number {
  return Math.min((poAmount * RULES.tolerancePct) / 100, RULES.toleranceCapInr);
}

export const TAGS = {
  invalidVendor: "Invalid vendor",
  duplicate: "Duplicate invoice",
  bankChanged: "Bank changed",
  reviewCalc: "Review calc",
  poIssues: "PO issues",
  poUsed: "PO used",
  amountMismatch: "Amount mismatch",
  vendorCreep: "Vendor creep",
  missingInfo: "Missing info",
} as const;
