/** Indian rupee formatting: 500300 -> ₹5,00,300 */
export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return "₹" + rounded.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export const normId = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|india)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}
