# Invoice Agent: invoice PDF in, payment decision out

Zamp AI Solutions Associate case study, PS-1 (Finance / AP). By Shambhavi KM.

An accounts-payable assistant for a mid-size company ("Acme Retail"). Upload a vendor invoice (a clean PDF or a scan) and it:

1. **Reads it with AI.** Gemini pulls out vendor, GSTIN, invoice #, date, PO #, line items, subtotal, tax, total and bank details.
2. **Runs it through clear business rules** and decides **Approve / Needs review / Reject**, with the reasoning written in plain English.
3. **Shows every step live**, and logs every run to a dashboard.

**Design principle: AI reads, rules decide.** AI handles the messy part (different layouts, scans). The payment decision comes from rules finance can read, tune and audit (`lib/rules.ts`, `lib/config.ts`). The same invoice with the same data always gets the same decision.

## The checks

| # | Check | Outcome |
|---|---|---|
| 1 | Read invoice | Missing key fields → Review `Missing info` |
| 2 | Vendor | Not an approved vendor → **Reject** `Invalid vendor` · Bank account differs from records → Review, **high priority** `Bank changed` |
| 3 | Duplicates | Same vendor + invoice # already processed → **Reject** `Duplicate invoice` |
| 4 | Maths | Lines ≠ subtotal, or subtotal + tax ≠ total → Review `Review calc` |
| 5 | Find PO | No PO / unknown PO / someone else's PO → Review `PO issues` (suggests the likely PO) |
| 6 | Match amount | Compares subtotal (pre-tax) with the PO's **remaining** balance. Within 1% and under ₹5,000 is OK · PO already fully billed → `PO used` · over the limit → `Amount mismatch` |
| 7 | Vendor history | 3+ small overcharges from the same vendor in 120 days → Review `Vendor creep` |
| 8 | Decision | Rejects stop immediately. All review issues are collected so the reviewer sees everything at once. |

Only **approved** invoices reduce a PO's remaining balance.

## Demo invoices (`public/samples`, also one click in the app)

Run them in order after **Reset demo data**:

| File | Expected |
|---|---|
| 01 Dell laptops | ✅ Approve (₹300 over, within limit) |
| 02 → 03 → 04 Urban Ladder | ✅ partial, ✅ uses up the PO, ⚠️ `PO used` |
| 05 Quick Office (scanned, no PO) | ⚠️ `PO issues`, suggests PO-1051 |
| 06 AWS (bank changed) | ⚠️ `Bank changed`, high priority |
| 07 Swift Logistics | ⚠️ `Vendor creep` (4th small overcharge) |
| 08 Dell laptops again | ⛔ `Duplicate invoice` |
| 09 Dell monitors | ⚠️ `Review calc` (total off by ₹2,000) |
| 10 Zenith Traders | ⛔ `Invalid vendor` |

`npm run test:rules` checks all of these against the rules, with no AI or database needed.

## Stack

Next.js (UI + API) · Google Gemini (reading invoices) · Supabase Postgres (vendors, POs, run history) · Vercel (hosting).

## Setup

1. Supabase → SQL Editor → run `supabase/schema.sql`.
2. Set environment variables (see `.env.example`): `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy, open the app, and click **Reset demo data** once to load vendors and POs.
