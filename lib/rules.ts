// "AI reads, rules decide."
// Everything in this file is plain, deterministic logic: same invoice + same data = same decision.
import { RULES, TAGS, toleranceFor } from "./config";
import { digits, inr, normId, normName } from "./format";
import type { CheckOutcome, Extracted, PurchaseOrder, Run, StageResult, Vendor } from "./types";

export type Context = { vendors: Vendor[]; pos: PurchaseOrder[]; runs: Run[]; now?: Date };

export const STAGE_LABELS: Record<StageResult["key"], string> = {
  read: "Read invoice",
  vendor: "Check vendor",
  duplicate: "Check duplicates",
  tax: "Check the maths",
  po: "Find purchase order",
  match: "Match amount to PO",
  pattern: "Check vendor history",
  decision: "Decision",
};

const stage = (key: StageResult["key"], status: StageResult["status"], summary: string, tags: string[] = []): StageResult => ({
  key, label: STAGE_LABELS[key], status, summary, tags,
});

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
  const readNote = `${inv.is_scanned ? "Scanned image — read with AI vision. " : ""}Found ${inv.line_items.length} line item(s), total ${inr(inv.total)}.`;
  if (missing.length) {
    stages.push(stage("read", "warn", `${readNote} Could not find: ${missing.join(", ")}.`, [TAGS.missingInfo]));
    reviewTags.push(TAGS.missingInfo);
  } else {
    stages.push(stage("read", "pass", readNote));
  }

  // ---------- 2. VENDOR ----------
  const vendor = findVendor(inv, ctx.vendors);
  if (!vendor) {
    stages.push(stage("vendor", "fail", `"${inv.vendor_name ?? "Unknown"}" is not on the approved vendor list. We don't pay companies we haven't onboarded.`, [TAGS.invalidVendor]));
    return finish(stages, "Reject", "normal", [TAGS.invalidVendor],
      `Rejected. "${inv.vendor_name ?? "Unknown vendor"}" is not an approved vendor, so this invoice cannot be paid. If this is a new supplier, they need to be onboarded first.`,
      { vendor: null, po: null, variance: null, withinTolerance: false, poCharge: 0 });
  }
  const invAcct = digits(inv.bank_account);
  if (invAcct && invAcct !== digits(vendor.bank_account)) {
    priority = "high";
    reviewTags.push(TAGS.bankChanged);
    stages.push(stage("vendor", "warn",
      `${vendor.name} is approved, but the invoice asks for payment to account ending ${invAcct.slice(-4)}. Our records say ${vendor.bank_name} account ending ${vendor.bank_account.slice(-4)}. Possible payment fraud — confirm by phone with a known contact before paying.`,
      [TAGS.bankChanged]));
  } else {
    stages.push(stage("vendor", "pass",
      `${vendor.name} is an approved vendor. ${invAcct ? "Bank details match our records." : "No bank details on the invoice — payment goes to the account on file."}`));
  }

  // ---------- 3. DUPLICATE ----------
  const invNo = normId(inv.invoice_number);
  const dup = invNo
    ? ctx.runs.find((r) => r.vendor_id === vendor.id && r.decision !== "Reject" && normId(r.invoice_number) === invNo)
    : undefined;
  if (dup) {
    stages.push(stage("duplicate", "fail",
      `Invoice ${inv.invoice_number} from ${vendor.name} was already processed on ${new Date(dup.created_at).toLocaleDateString("en-IN")} (${dup.decision}). Paying again would mean paying twice.`,
      [TAGS.duplicate]));
    return finish(stages, "Reject", "normal", [TAGS.duplicate],
      `Rejected. This is a duplicate of invoice ${inv.invoice_number}, already processed on ${new Date(dup.created_at).toLocaleDateString("en-IN")}. No payment needed.`,
      { vendor, po: null, variance: null, withinTolerance: false, poCharge: 0 });
  }
  stages.push(stage("duplicate", "pass", `No earlier invoice ${inv.invoice_number ?? ""} from this vendor.`));

  // ---------- 4. TAX / MATHS ----------
  const mathProblems: string[] = [];
  const lineSum = inv.line_items.reduce((s, l) => s + (l.amount ?? 0), 0);
  if (inv.subtotal !== null && inv.line_items.length && Math.abs(lineSum - inv.subtotal) > RULES.roundingInr) {
    mathProblems.push(`line items add up to ${inr(lineSum)} but subtotal says ${inr(inv.subtotal)}`);
  }
  if (inv.subtotal !== null && inv.tax !== null && inv.total !== null) {
    const expected = inv.subtotal + inv.tax;
    if (Math.abs(expected - inv.total) > RULES.roundingInr) {
      mathProblems.push(`subtotal ${inr(inv.subtotal)} + tax ${inr(inv.tax)} = ${inr(expected)}, but the invoice total says ${inr(inv.total)} (off by ${inr(inv.total - expected)})`);
    }
  }
  if (mathProblems.length) {
    reviewTags.push(TAGS.reviewCalc);
    stages.push(stage("tax", "warn", `The numbers don't add up: ${mathProblems.join("; ")}.`, [TAGS.reviewCalc]));
  } else {
    stages.push(stage("tax", inv.total === null ? "skip" : "pass", inv.total === null ? "Skipped — totals missing." : "Line items, subtotal, tax and total all add up."));
  }

  // ---------- 5. FIND PO ----------
  let po: PurchaseOrder | null = null;
  const remainingOf = (p: PurchaseOrder) => p.amount - p.invoiced;
  if (inv.po_number) {
    const found = ctx.pos.find((p) => normId(p.id) === normId(inv.po_number));
    if (!found) {
      reviewTags.push(TAGS.poIssues);
      stages.push(stage("po", "warn", `PO "${inv.po_number}" doesn't exist in our records.`, [TAGS.poIssues]));
    } else if (found.vendor_id !== vendor.id) {
      reviewTags.push(TAGS.poIssues);
      stages.push(stage("po", "warn", `${found.id} belongs to a different vendor, not ${vendor.name}.`, [TAGS.poIssues]));
    } else {
      po = found;
      stages.push(stage("po", "pass", `Found ${po.id}: ${po.description}. Value ${inr(po.amount)}, already billed ${inr(po.invoiced)}, remaining ${inr(remainingOf(po))}.`));
    }
  } else {
    reviewTags.push(TAGS.poIssues);
    const open = ctx.pos.filter((p) => p.vendor_id === vendor.id && remainingOf(p) > 0);
    const sub = inv.subtotal ?? 0;
    const candidates = open
      .map((p) => ({ p, gap: Math.abs(remainingOf(p) - sub) }))
      .filter(({ p, gap }) => gap <= toleranceFor(p.amount) || sub <= remainingOf(p))
      .sort((a, b) => a.gap - b.gap);
    const best = candidates[0]?.p;
    stages.push(stage("po", "warn",
      best
        ? `No PO number on the invoice. Suggested match: ${best.id} (${best.description}, ${inr(remainingOf(best))} remaining) — same vendor, amount fits. A person should confirm.`
        : `No PO number on the invoice, and no open PO from ${vendor.name} fits this amount.`,
      [TAGS.poIssues]));
  }

  // ---------- 6. MATCH AMOUNT ----------
  let variance: number | null = null;
  let withinTolerance = false;
  let poCharge = 0;
  let matchNote = "";
  if (!po || inv.subtotal === null) {
    stages.push(stage("match", "skip", "Skipped — no confirmed PO to compare against."));
  } else {
    const remaining = remainingOf(po);
    const tol = toleranceFor(po.amount);
    if (remaining <= 0) {
      reviewTags.push(TAGS.poUsed);
      stages.push(stage("match", "warn", `${po.id} is already fully billed (${inr(po.invoiced)} of ${inr(po.amount)}). This invoice for ${inr(inv.subtotal)} has nothing left to bill against.`, [TAGS.poUsed]));
    } else {
      variance = inv.subtotal - remaining;
      if (variance <= 0) {
        poCharge = inv.subtotal;
        const left = remaining - inv.subtotal;
        matchNote = left > 0 ? `Partial billing: ${inr(left)} will remain open on ${po.id}.` : `This bills ${po.id} in full.`;
        stages.push(stage("match", "pass", `Subtotal ${inr(inv.subtotal)} vs remaining ${inr(remaining)} on ${po.id}. ${matchNote}`));
        variance = 0;
      } else if (variance <= tol) {
        withinTolerance = true;
        poCharge = inv.subtotal;
        matchNote = `Billed ${inr(variance)} over the PO — within the allowed limit (${RULES.tolerancePct}%, max ${inr(RULES.toleranceCapInr)} → ${inr(tol)} here).`;
        stages.push(stage("match", "pass", `Subtotal ${inr(inv.subtotal)} vs remaining ${inr(remaining)} on ${po.id}. ${matchNote}`));
      } else {
        reviewTags.push(TAGS.amountMismatch);
        stages.push(stage("match", "warn",
          `Subtotal ${inr(inv.subtotal)} is ${inr(variance)} more than what's left on ${po.id} (${inr(remaining)}${po.invoiced ? `, after ${inr(po.invoiced)} already billed` : ""}). Allowed limit is ${inr(tol)}.`,
          [TAGS.amountMismatch]));
      }
    }
  }

  // ---------- 7. VENDOR HISTORY (creep) ----------
  if (withinTolerance && variance && variance > 0) {
    const since = now.getTime() - RULES.creepWindowDays * 86400000;
    const earlier = ctx.runs.filter((r) =>
      r.vendor_id === vendor.id && r.decision === "Approve" && r.within_tolerance && (r.variance ?? 0) > 0 && new Date(r.created_at).getTime() >= since);
    if (earlier.length >= RULES.creepCount) {
      reviewTags.push(TAGS.vendorCreep);
      const total = earlier.reduce((s, r) => s + (r.variance ?? 0), 0) + variance;
      stages.push(stage("pattern", "warn",
        `${vendor.name} has billed slightly over the PO on ${earlier.length} earlier invoices in the last ${RULES.creepWindowDays} days (${earlier.map((r) => inr(r.variance)).join(", ")}), and again now (${inr(variance)}). Each one is small; together that's ${inr(total)}. Worth a conversation with the vendor.`,
        [TAGS.vendorCreep]));
    } else {
      stages.push(stage("pattern", "pass", `Small overcharge noted. ${earlier.length} similar one(s) from this vendor recently — below the ${RULES.creepCount}-time alert level.`));
    }
  } else {
    stages.push(stage("pattern", "pass", "No unusual billing pattern for this vendor."));
  }

  // ---------- 8. DECISION ----------
  const tags = [...new Set(reviewTags)];
  if (tags.length) {
    const reasons = stages.filter((s) => s.status === "warn").map((s) => `• ${s.label}: ${s.summary}`);
    return finish(stages, "Review", priority, tags,
      `Needs review${priority === "high" ? " (HIGH PRIORITY)" : ""}. ${tags.length} issue(s) found:\n${reasons.join("\n")}`,
      { vendor, po, variance, withinTolerance, poCharge: 0 });
  }

  const reason = [
    `Approved. Invoice ${inv.invoice_number} from ${vendor.name} matches ${po!.id} (${po!.description}).`,
    `Amount billed: ${inr(inv.subtotal)} before tax; PO had ${inr(po!.amount - po!.invoiced)} remaining. ${matchNote}`,
    `Tax is calculated correctly (total ${inr(inv.total)}). The vendor is approved and the bank details match our records.`,
    `To verify manually: open ${po!.id} in the PO sheet and compare it with the invoice subtotal.`,
  ].join("\n");
  return finish(stages, "Approve", "normal", [], reason, { vendor, po, variance, withinTolerance, poCharge });
}

function finish(
  stages: StageResult[],
  decision: CheckOutcome["decision"],
  priority: CheckOutcome["priority"],
  tags: string[],
  reason: string,
  rest: Pick<CheckOutcome, "vendor" | "po" | "variance" | "withinTolerance" | "poCharge">,
): CheckOutcome {
  // Any stage we never reached (because of a reject) is shown as skipped.
  const order: StageResult["key"][] = ["read", "vendor", "duplicate", "tax", "po", "match", "pattern"];
  for (const k of order) {
    if (!stages.find((s) => s.key === k)) stages.push(stage(k, "skip", "Skipped — invoice already rejected."));
  }
  stages.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const icon = decision === "Approve" ? "pass" : decision === "Reject" ? "fail" : "warn";
  stages.push(stage("decision", icon, reason.split("\n")[0], tags));
  return { stages, decision, priority, tags, reason, ...rest };
}
