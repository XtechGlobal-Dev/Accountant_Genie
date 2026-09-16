-- Chart of accounts corrections from the au-tax-rules audit.
--
-- 290 was an EXPENSE account for "refunds of purchases or customer payments":
-- a refund given to a customer coded there inflated G11/1B instead of
-- reducing G1/1A. It becomes an INCOME account. Lines already posted to it
-- keep the treatment they were posted under (the snapshot on the line), so no
-- historical BAS changes; only new postings take the corrected side.
--
-- Three accounts whose default treatment depends on facts the chart cannot
-- know (grants, overseas travel, workers compensation by state) are flagged
-- REQUIRES_VERIFICATION for each firm's registered tax advisor.
--
-- System accounts only ("firmId" IS NULL). Firms' custom accounts are theirs.

UPDATE "Account"
SET "type" = 'INCOME',
    "gstTreatment" = 'GST_ON_INCOME',
    "name" = 'Customer Refunds',
    "description" = 'Refunds given to customers — reduces sales, G1 and 1A'
WHERE "code" = 290 AND "firmId" IS NULL AND "clientId" IS NULL AND "isSystem" = true;

UPDATE "Account"
SET "requiresVerification" = true,
    "taxNote" = 'Not every grant is outside the GST system: a grant paid for a supply (something the client has to do in return) is a taxable sale at G1/1A, and fuel tax credits report at their own label, not here. BAS_EXCLUDED is the safe default only while the advisor confirms which grants this firm''s clients receive.'
WHERE "code" = 203 AND "firmId" IS NULL AND "clientId" IS NULL AND "isSystem" = true;

UPDATE "Account"
SET "requiresVerification" = true,
    "description" = 'International airfares are GST free; overseas accommodation and meals are outside the GST system',
    "taxNote" = 'International air travel is GST-free (reports at G11). Accommodation, meals and transport consumed overseas are not a taxable supply in Australia at all, which some practitioners code BAS_EXCLUDED rather than GST_FREE. The difference is G11 only — never 1B — but the advisor decides which this firm reports.'
WHERE "code" = 493 AND "firmId" IS NULL AND "clientId" IS NULL AND "isSystem" = true;

UPDATE "Account"
SET "requiresVerification" = true,
    "taxNote" = 'Workers compensation is a state scheme and the GST treatment of premiums differs between them (some insurer-issued policies carry GST; some statutory scheme charges do not). The firm''s state is on the Firm record — the advisor confirms the treatment for it.'
WHERE "code" = 510 AND "firmId" IS NULL AND "clientId" IS NULL AND "isSystem" = true;
