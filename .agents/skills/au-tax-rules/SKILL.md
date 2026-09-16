---
name: au-tax-rules
description: Australian GST, BAS and financial-year rules for this codebase. Load BEFORE writing or reviewing any code that touches GST amounts, tax treatments, BAS labels, financial-year boundaries, quarters, depreciation thresholds, or any figure that reaches a tax report. Triggers on GST, BAS, ATO, tax code, financial year, FY, quarter, EOFY, TPAR, depreciation, instant asset write-off, PAYG.
---

# Australian tax rules

## The rule that outranks everything

**Never invent an Australian tax rule.** If a rule is uncertain, do not guess and do not infer it from
another rule. Isolate it behind a versioned abstraction, mark it `REQUIRES_VERIFICATION`, and flag it
for the registered tax advisor. A plausible-looking wrong tax rule is the most damaging thing that can
ship in this product, because it is invisible until the ATO finds it.

## GST arithmetic

Australian prices are quoted **GST-inclusive**. The GST embedded in a gross amount is:

```
GST = gross / 11
net = gross − GST
```

**Not** `gross × 0.10`. That overstates GST by 10% on every single transaction and is the most common
bug in home-grown BAS code. Use `server/src/au/gst.ts`; never re-derive the maths inline.

Rounding is half-away-from-zero, sign-preserving. Money is always integer cents.

## The four treatments

| Treatment | Meaning | Examples | BAS effect |
|---|---|---|---|
| `GST` | 10% applies | Most sales and expenses | G1, 1A or 1B |
| `GST_FREE` | GST-free supply | Basic food, medical, education, exports, council rates, international travel | G1 only, no 1A/1B |
| `INPUT_TAXED` | Input taxed | Residential rent, financial supplies, bank fees, interest | No GST credit claimable |
| `BAS_EXCLUDED` | Not reported on BAS | Wages, drawings, ATO payments, transfers, loan principal, depreciation | Excluded entirely |

Treatment lives on the account and may be overridden per transaction. Never assume every expense is
`GST`. The classic errors, all of which look right until an accountant reviews them:

- **Bank fees and interest are `INPUT_TAXED`**, not `GST`. There is no GST credit on them.
- **Wages are `BAS_EXCLUDED`** and report at W1, never at 1B.
- **Council rates and government licences are `GST_FREE`.**
- **Loan repayment principal is `BAS_EXCLUDED`**; only the interest portion is an expense. Never
  expense the whole repayment.
- **Transfers between the client's own accounts are `BAS_EXCLUDED`** and must never appear as income
  or expense.

## BAS labels

| Label | Meaning |
|---|---|
| G1 | Total sales (GST-inclusive) |
| 1A | GST on sales — amount owed to the ATO |
| 1B | GST on purchases — amount the ATO owes |
| W1 | Total salary, wages and other payments |
| W2 | Amounts withheld from W1 |

Simple BAS covers the core GST and PAYG figures. Extended BAS adds detail. Store
`calculated_value`, `adjustment_value` and `final_value` as three separate columns — a manual
adjustment must never overwrite what the system computed, or the audit trail is gone.

**BAS figures are never computed by an LLM.** They are deterministic aggregations over validated
journal lines. An LLM may classify a transaction; it may not calculate a tax figure.

## Financial year

The AU financial year runs **1 July → 30 June**. By convention `FY2026` is the year *ending*
30 June 2026, i.e. 1 Jul 2025 → 30 Jun 2026.

BAS quarters: Q1 Jul–Sep · Q2 Oct–Dec · Q3 Jan–Mar · Q4 Apr–Jun.

Use `server/src/au/fy.ts`. Ranges are half-open `[start, end)` in UTC so Postgres and JS agree regardless
of server timezone. Never hardcode a current year — derive it. Opening balances are always dated 1 July.

## Versioning tax rules

Tax legislation changes. Historical reports must continue to reproduce exactly.

- **Never** update a tax rule row in place.
- **Always** insert a new version with `effective_from` / `effective_to`.
- Every stored tax calculation records which rule version produced it.

This applies to GST rates, depreciation thresholds, the instant asset write-off cap, and company tax
rates. A report for FY2024 must produce the same numbers in 2030 as it did in 2024.

## Before you finish

- [ ] Is every GST figure derived through `gst.ts`, never inline arithmetic?
- [ ] Is the treatment correct, or did you default everything to `GST`?
- [ ] Are financial-year boundaries derived, not hardcoded?
- [ ] If you introduced a tax rule, is it versioned and advisor-verified?
- [ ] Did an LLM calculate any tax figure? If yes, that is a defect — fix it.
