// "AI reads, rules decide."
// Everything in this file is plain, deterministic logic: same invoice + same data = same decision.
import { RULES, TAGS, toleranceFor } from "./config";
import { digits, inr, normId, normName } from "./format";
import type { CheckOutcome, Extracted, PurchaseOrder, Run, StageResult, Vendor } from "./types";

export type Context = { vendors: Vendor[]; pos: PurchaseOrder[]; runs: Run[]; now?: Date };

export const STAGE_LABELS: Record<StageResult["key"], string> = {
  read: "Read invoice",
  vendor: "Vendor and bank details",
  duplicate: "Duplicate check",
  tax: "Totals and tax",
  po: "Purchase order",
  match: "Amount vs purchase order",
  pattern: "Vendor billing history",
  decision: "Decision",
};

const stage = (key: StageResult["key"], status: StageResult["status"], summary: string, tags: string[] = []): StageResult => ({
  key, label: STAGE_LABELS[key], status, summary, tags,
});

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function findVendor(inv: Extracted, vendors: Vendor[]): Vendor | null {
  const g = normId(inv.vendor_gstin);
  if (g) {
    const byGst = vendors.find((v) => normId(v.gstin) === g);
    if (byGst) return byGst;
  }
  const n = normName(inv.vendor_name);
  if (!n) return null;
  return vendors.find((v) => normName(v.name) === n) ?? null;
}

export function evaluate(inv: Extracted, ctx: Context): CheckOutcome {
  const now = ctx.now ?? new Date();
  const stages: StageResult[] = [];
  const reviewTags: string[] = [];
  let priority: "high" | "normal" = "normal";

  // ---------- 1. READ ----------
  const missing = [
    !inv.vendor_name && "vendor name",
    !inv.invoice_number && "invoice number",
    inv.subtotal === null && "subtotal",
    inv.total === null && "total",
  ].filter(Boolean) as string[];
  const lines = inv.line_items.length;
  const readNote = `${inv.is_scanned ? "Scanned document. " : ""}${lines} line item${lines === 1 ? "" : "s"}, total ${inr(inv.total)}.`;
  if (missing.length) {
    stages.push(stage("read", "warn", `${readNote} Missing: ${missing.join(", ")}.`, [TAGS.missingInfo]));
    reviewTags.push(TAGS.missingInfo);
  } else {
    stages.push(stage("read", "pass", readNote));
  }

  // ---------- 2. VENDOR ----------
  const vendor = findVendor(inv, ctx.vendors);
  if (!vendor) {
    stages.push(stage("vendor", "fail", `${inv.vendor_name ?? "This vendor"} is not on the approved vendor list.`, [TAGS.invalidVendor]));
    return finish(stages, "Reject", "normal", [TAGS.invalidVendor],
      `${inv.vendor_name ?? "The vendor"} is not an approved vendor. New suppliers must be onboarded before they can be paid.`,
      { vendor: null, po: null, variance: null, withinTolerance: false, poCharge: 0 });
  }
  const invAcct = digits(inv.bank_account);
  if (invAcct && invAcct !== digits(vendor.bank_account)) {
    priority = "high";
    reviewTags.push(TAGS.bankChanged);
    stages.push(stage("vendor", "warn",
      `Payment requested to account ending ${invAcct.slice(-4)}. Account on file: ${vendor.bank_name}, ending ${vendor.bank_account.slice(-4)}.`,
      [TAGS.bankChanged]));
  } else {
    stages.push(stage("vendor", "pass",
      invAcct ? "Approved vendor. Bank account matches records." : "Approved vendor. No bank details on invoice; the account on file will be used."));
  }

  // ---------- 3. DUPLICATE ----------
  const invNo = normId(inv.invoice_number);
  const dup = invNo
    ? ctx.runs.find((r) => r.vendor_id === vendor.id && r.decision !== "Reject" && normId(r.invoice_number) === invNo)
    : undefined;
  if (dup) {
    stages.push(stage("duplicate", "fail", `Invoice ${inv.invoice_number} was already processed on ${day(dup.created_at)}.`, [TAGS.duplicate]));
    return finish(stages, "Reject", "normal", [TAGS.duplicate],
      `Duplicate of invoice ${inv.invoice_number}, already processed on ${day(dup.created_at)}.`,
      { vendor, po: null, variance: null, withinTolerance: false, poCharge: 0 });
  }
  stages.push(stage("duplicate", "pass", "No previous submission of this invoice."));

  // ---------- 4. TOTALS AND TAX ----------
  const mathProblems: string[] = [];
  const lineSum = inv.line_items.reduce((s, l) => s + (l.amount ?? 0), 0);
  if (inv.subtotal !== null && inv.line_items.length && Math.abs(lineSum - inv.subtotal) > RULES.roundingInr) {
    mathProblems.push(`Line items total ${inr(lineSum)}; subtotal states ${inr(inv.subtotal)}.`);
  }
  if (inv.subtotal !== null && inv.tax !== null && inv.total !== null) {
    const expected = inv.subtotal + inv.tax;
    if (Math.abs(expected - inv.total) > RULES.roundingInr) {
      mathProblems.push(`Subtotal plus tax is ${inr(expected)}; invoice total is ${inr(inv.total)} (${inr(Math.abs(inv.total - expected))} difference).`);
    }
  }
  if (mathProblems.length) {
    reviewTags.push(TAGS.reviewCalc);
    stages.push(stage("tax", "warn", mathProblems.join(" "), [TAGS.reviewCalc]));
  } else {
    stages.push(stage("tax", inv.total === null ? "skip" : "pass", inv.total === null ? "Not run: totals missing." : "Line items, tax and total reconcile."));
  }

  // ---------- 5. PURCHASE ORDER ----------
  let po: PurchaseOrder | null = null;
  const remainingOf = (p: PurchaseOrder) => p.amount - p.invoiced;
  if (inv.po_number) {
    const found = ctx.pos.find((p) => normId(p.id) === normId(inv.po_number));
    if (!found) {
      reviewTags.push(TAGS.poIssues);
      stages.push(stage("po", "warn", `${inv.po_number} does not exist in our records.`, [TAGS.poIssues]));
    } else if (found.vendor_id !== vendor.id) {
      reviewTags.push(TAGS.poIssues);
      stages.push(stage("po", "warn", `${found.id} is issued to a different vendor.`, [TAGS.poIssues]));
    } else {
      po = found;
      stages.push(stage("po", "pass", `${po.id}, ${po.description}. ${inr(remainingOf(po))} remaining of ${inr(po.amount)}.`));
    }
  } else {
    reviewTags.push(TAGS.poIssues);
    const open = ctx.pos.filter((p) => p.vendor_id === vendor.id && remainingOf(p) > 0);
    const sub = inv.subtotal ?? 0;
    const best = open
      .map((p) => ({ p, gap: Math.abs(remainingOf(p) - sub) }))
      .filter(({ p, gap }) => gap <= toleranceFor(p.amount) || sub <= remainingOf(p))
      .sort((a, b) => a.gap - b.gap)[0]?.p;
    stages.push(stage("po", "warn",
      best
        ? `No PO reference on invoice. Likely match: ${best.id}, ${best.description} (${inr(remainingOf(best))} remaining).`
        : `No PO reference on invoice, and no open PO for this vendor fits the amount.`,
      [TAGS.poIssues]));
  }

  // ---------- 6. AMOUNT VS PO ----------
  let variance: number | null = null;
  let withinTolerance = false;
  let poCharge = 0;
  let matchNote = "";
  if (!po || inv.subtotal === null) {
    stages.push(stage("match", "skip", "Not run: no confirmed purchase order."));
  } else {
    const remaining = remainingOf(po);
    const tol = toleranceFor(po.amount);
    if (remaining <= 0) {
      reviewTags.push(TAGS.poUsed);
      stages.push(stage("match", "warn", `${po.id} is fully billed (${inr(po.invoiced)} of ${inr(po.amount)}). Nothing remains for this ${inr(inv.subtotal)} invoice.`, [TAGS.poUsed]));
    } else {
      variance = inv.subtotal - remaining;
      if (variance <= 0) {
        poCharge = inv.subtotal;
        const left = remaining - inv.subtotal;
        matchNote = left > 0 ? `Partial billing; ${inr(left)} stays open on ${po.id}.` : `Bills ${po.id} in full.`;
        stages.push(stage("match", "pass", `Billed ${inr(inv.subtotal)} against ${inr(remaining)} remaining. ${matchNote}`));
        variance = 0;
      } else if (variance <= tol) {
        withinTolerance = true;
        poCharge = inv.subtotal;
        matchNote = `${inr(variance)} over the PO, within the ${inr(tol)} limit.`;
        stages.push(stage("match", "pass", `Billed ${inr(inv.subtotal)} against ${inr(remaining)} remaining. ${matchNote}`));
      } else {
        reviewTags.push(TAGS.amountMismatch);
        stages.push(stage("match", "warn",
          `Billed ${inr(inv.subtotal)} against ${inr(remaining)} remaining: ${inr(variance)} over, above the ${inr(tol)} limit.`,
          [TAGS.amountMismatch]));
      }
    }
  }

  // ---------- 7. VENDOR BILLING HISTORY ----------
  if (withinTolerance && variance && variance > 0) {
    const since = now.getTime() - RULES.creepWindowDays * 86400000;
    const earlier = ctx.runs.filter((r) =>
      r.vendor_id === vendor.id && r.decision === "Approve" && r.within_tolerance && (r.variance ?? 0) > 0 && new Date(r.created_at).getTime() >= since);
    if (earlier.length >= RULES.creepCount) {
      reviewTags.push(TAGS.vendorCreep);
      const total = earlier.reduce((s, r) => s + (r.variance ?? 0), 0) + variance;
      stages.push(stage("pattern", "warn",
        `Overcharge number ${earlier.length + 1} in ${RULES.creepWindowDays} days (${[...earlier.map((r) => inr(r.variance)), inr(variance)].join(", ")}), ${inr(total)} in total.`,
        [TAGS.vendorCreep]));
    } else {
      stages.push(stage("pattern", "pass", earlier.length
        ? `${earlier.length} similar overcharge${earlier.length === 1 ? "" : "s"} in ${RULES.creepWindowDays} days; alert at ${RULES.creepCount}.`
        : "No unusual billing pattern."));
    }
  } else {
    stages.push(stage("pattern", "pass", "No unusual billing pattern."));
  }

  // ---------- 8. DECISION ----------
  const tags = [...new Set(reviewTags)];
  if (tags.length) {
    const issues = stages.filter((s) => s.status === "warn").map((s) => `${s.tags.join(", ")}: ${s.summary}`);
    return finish(stages, "Review", priority, tags,
      `${tags.length === 1 ? "1 issue" : `${tags.length} issues`} to resolve before payment.\n${issues.join("\n")}`,
      { vendor, po, variance, withinTolerance, poCharge: 0 });
  }

  return finish(stages, "Approve", "normal", [],
    `Matches ${po!.id}. ${matchNote} Vendor, bank details, tax and totals verified.`,
    { vendor, po, variance, withinTolerance, poCharge });
}

function finish(
  stages: StageResult[],
  decision: CheckOutcome["decision"],
  priority: CheckOutcome["priority"],
  tags: string[],
  reason: string,
  rest: Pick<CheckOutcome, "vendor" | "po" | "variance" | "withinTolerance" | "poCharge">,
): CheckOutcome {
  // Any check we never reached (because of a rejection) is shown as not run.
  const order: StageResult["key"][] = ["read", "vendor", "duplicate", "tax", "po", "match", "pattern"];
  for (const k of order) {
    if (!stages.find((s) => s.key === k)) stages.push(stage(k, "skip", "Not run: invoice rejected."));
  }
  stages.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const icon = decision === "Approve" ? "pass" : decision === "Reject" ? "fail" : "warn";
  stages.push(stage("decision", icon, reason.split("\n")[0], tags));
  return { stages, decision, priority, tags, reason, ...rest };
}
