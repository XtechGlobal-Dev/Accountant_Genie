import type { AccountType, GstTreatment } from "@/generated/prisma";

export interface SeedAccount {
  code: number;
  name: string;
  type: AccountType;
  gstTreatment: GstTreatment;
  description?: string;
  isCashAtBank?: boolean;
  /// Tax treatment not yet confirmed by the registered advisor
  requiresVerification?: boolean;
  taxNote?: string;
}

/**
 * Default Australian chart of accounts.
 *
 * SOURCE: supplied by the practice on 2026-09-16 and reproduced here as given,
 * code for code. Where the source sheet could not be represented exactly, the
 * row carries `requiresVerification` and a `taxNote` saying what was assumed —
 * nothing was silently changed. Those rows surface in the advisor banner on
 * /accounts and must be cleared by the registered tax agent before any BAS
 * derived from them is relied on.
 *
 * TWO ACCOUNTS WERE ADDED that the source sheet does not contain: 701 Cash at
 * Bank and 804 Credit Card. They are not editorial — `reconcile/service.ts`
 * posts the bank side of every accepted transaction against them, so without
 * them no bank row can reach the ledger at all. See BANK_LEDGER_CODE.
 *
 * Ranges, as the source sheet uses them:
 *     0–1    Sentinel accounts
 *   200–299  Income
 *   290–579  Expenses
 *   580–699  Payroll, tax and finance
 *   700–799  Assets
 *   800–899  Liabilities
 *   900–999  Equity
 *
 * Custom accounts created by a firm must use codes above 1000.
 */
export const AU_CHART_OF_ACCOUNTS: SeedAccount[] = [
  // ------------------------------------------------------------- Sentinels
  // Two distinct states, deliberately. "Unknown" means the engine could not
  // classify it. "Suspense" means a human parked it pending information from
  // the client. Collapsing them loses the reason a transaction is unresolved.
  { code: 0, name: "Unknown", type: "UNKNOWN", gstTreatment: "UNALLOCATED", description: "Select GST" },
  { code: 1, name: "Suspense", type: "UNKNOWN", gstTreatment: "UNALLOCATED", description: "Select GST" },

  // ---------------------------------------------------------------- Income
  { code: 200, name: "Sales - GST on Income", type: "INCOME", gstTreatment: "GST_ON_INCOME", description: "Main business sales" },
  { code: 201, name: "Sales - GST-Free Income", type: "INCOME", gstTreatment: "GST_FREE_INCOME", description: "Export sales, healthcare, basic foods" },
  {
    code: 202,
    name: "Interest Income",
    type: "INCOME",
    gstTreatment: "GST_FREE_INCOME",
    description: "Interest earned from banks, term deposits, and other interest-bearing accounts",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE INCOME PER THE SUPPLIED CHART. Interest is generally a financial supply and therefore INPUT TAXED rather than GST-free. The two differ on the BAS: GST-free income reports at G1, input-taxed sales are backed out at G4. Some practitioners do code interest as GST Free Income. CONFIRM with the registered advisor — an error here misstates G1 for every client holding a bank account.",
  },
  {
    code: 203,
    name: "Rebates",
    type: "INCOME",
    gstTreatment: "GST_FREE_INCOME",
    description: "Rebates, refunds, incentive payments, and grants",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE INCOME PER THE SUPPLIED CHART. Rebates, incentives and government grants do not share one treatment: a trade rebate is usually a GST adjustment to the original purchase, while most government grants are outside the GST system (BAS excluded) rather than GST-free. Reporting them at G1 overstates turnover. CONFIRM with the registered advisor.",
  },
  {
    code: 204,
    name: "Rent Received",
    type: "INCOME",
    gstTreatment: "GST_ON_INCOME",
    description: "Income earned from renting out property, equipment, or other assets",
    requiresVerification: true,
    taxNote:
      "SET AS GST ON INCOME PER THE SUPPLIED CHART. This is correct for COMMERCIAL rent and equipment hire. RESIDENTIAL rent is input taxed and carries no GST — coding it here charges GST on a supply that is not taxable. One account cannot hold both treatments; consider a separate residential rent account. CONFIRM with the registered advisor.",
  },
  { code: 205, name: "Other Income", type: "INCOME", gstTreatment: "GST_ON_INCOME", description: "Income received outside of normal business activities" },

  // -------------------------------------------------------------- Expenses
  {
    code: 290,
    name: "Refunds",
    type: "EXPENSE",
    gstTreatment: "GST_ON_EXPENSES",
    description: "Refunds of purchases or customer payments",
    requiresVerification: true,
    taxNote:
      "TYPED AS AN EXPENSE PER THE SUPPLIED CHART, covering two opposite things. A refund RECEIVED from a supplier is a credit against the purchase it reverses. A refund GIVEN to a customer reduces sales — coded as an expense it inflates G11/1B instead of reducing G1/1A, so the BAS overstates both sides. Consider a separate income-side account for customer refunds. CONFIRM with the registered advisor.",
  },
  { code: 300, name: "Advertising and Marketing", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Google Ads, Facebook Ads, flyers, signage" },
  { code: 310, name: "Accounting and Bookkeeping Fees", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Accountant fees, BAS agent fees" },
  {
    code: 320,
    name: "Bank Fees",
    type: "EXPENSE",
    gstTreatment: "GST_FREE_EXPENSES",
    description: "EFTPOS, monthly and international bank fees",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE PER THE SUPPLIED CHART. Bank account and transaction fees are generally an INPUT TAXED financial supply, not GST-free. Both deny an input tax credit, so 1B is unaffected, but the G-labels differ (GST-free acquisitions report at G14, input-taxed at G13). CONFIRM with the registered advisor.",
  },
  { code: 321, name: "Merchant Charges", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Merchant charges (containing GST)" },
  {
    code: 325,
    name: "Bank Charges (Non-GST)",
    type: "EXPENSE",
    gstTreatment: "GST_FREE_EXPENSES",
    description: "Regular bank account fees",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE PER THE SUPPLIED CHART. Same question as account 320 — bank charges are generally input taxed rather than GST-free. CONFIRM with the registered advisor.",
  },
  { code: 326, name: "Opening Stock", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Stock on Hand" },
  { code: 327, name: "Materials and supplies", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Materials and supplies" },
  { code: 328, name: "Purchases", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Cost of goods purchased for resale or use in business operations" },
  { code: 329, name: "Cleaning and Waste", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Costs for cleaning, waste removal, and disposal of business premises" },
  { code: 330, name: "Business Insurance Premiums", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Public liability, professional indemnity" },
  {
    code: 332,
    name: "Workcover",
    type: "EXPENSE",
    gstTreatment: "GST_FREE_EXPENSES",
    description: "Workers' compensation insurance expense",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE PER THE SUPPLIED CHART. Workers compensation is a state scheme and the GST treatment of premiums differs between them: some insurer-issued policies carry GST, some statutory scheme charges do not. The firm's state is on the Firm record — CONFIRM the treatment for it with the registered advisor.",
  },
  { code: 335, name: "Commissions Paid", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Commission payments made for sales, referrals, or performance-based incentives" },
  { code: 340, name: "Computer Equipment and Software", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Computer and office equipment" },
  { code: 350, name: "Consulting Fees", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Business consulting" },
  { code: 360, name: "Electricity, Gas and Water", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Business premises utilities" },
  { code: 365, name: "Rates & Land Taxes", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Council rates, land tax, and other property-related government charges" },
  { code: 370, name: "Directors or Management Fees", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "No GST on wages" },
  { code: 375, name: "Superannuation Expense", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "No GST on superannuation" },
  { code: 380, name: "Postage", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Business postage costs" },
  { code: 385, name: "Freight and Courier Services", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Courier deliveries" },
  { code: 388, name: "Filing Fees", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "Fees paid for government and regulatory filings (e.g. ASIC)." },
  { code: 390, name: "Home Office Expenses", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Home internet, power (apportioned - 15%)" },
  {
    code: 400,
    name: "Interest Charges",
    type: "EXPENSE",
    gstTreatment: "GST_FREE_EXPENSES",
    description: "No GST on loan interest",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE PER THE SUPPLIED CHART. Loan interest is generally an INPUT TAXED financial supply rather than GST-free. Neither yields an input tax credit, but they report at different G-labels. CONFIRM with the registered advisor.",
  },
  {
    code: 405,
    name: "Interest on Business Loans",
    type: "EXPENSE",
    gstTreatment: "GST_FREE_EXPENSES",
    description: "Loan interest",
    requiresVerification: true,
    taxNote:
      "SET AS GST FREE PER THE SUPPLIED CHART. Same question as account 400 — loan interest is generally input taxed. CONFIRM with the registered advisor.",
  },
  { code: 410, name: "Legal Fees", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Legal advice, contracts" },
  { code: 420, name: "Motor Vehicle Fuel", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Petrol/diesel for business vehicles" },
  { code: 425, name: "Motor Vehicle Repairs and Maintenance", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Mechanical repairs" },
  {
    code: 430,
    name: "Motor Vehicle Registration",
    type: "EXPENSE",
    gstTreatment: "GST_ON_EXPENSES",
    description: "Insurance portion GST, rego fee GST-free",
    requiresVerification: true,
    taxNote:
      "THE SUPPLIED CHART GIVES TWO TREATMENTS FOR THIS ACCOUNT — 'GST on Expenses / GST Free' — and an account can carry only one. GST on Expenses was taken, because the CTP insurance component of a registration usually does carry GST while the registration fee itself does not. A registration payment therefore needs its GST adjusted per transaction, or the account split in two. RESOLVE with the registered advisor.",
  },
  { code: 435, name: "Motor Vehicle Insurance", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Work-related motor vehicle insurance" },
  { code: 440, name: "Motor Vehicle Other Costs", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Tolls, business parking, cleaning" },
  { code: 450, name: "Office Supplies", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Stationery, printer ink, etc." },
  { code: 460, name: "Professional Memberships", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "CPA, industry associations" },
  { code: 470, name: "Subscriptions", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Business SaaS, magazines, software" },
  { code: 471, name: "Subscriptions Overseas", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Same as 470 but transactions outside of Australia (e.g. US)" },
  { code: 475, name: "Lease Payments", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Payments made for leasing property, equipment, or assets" },
  { code: 480, name: "Rent on Business Premises", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Commercial lease" },
  { code: 490, name: "Equipment Rental", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Machinery, tool hire" },
  { code: 500, name: "Repairs and Maintenance", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Repairs, maintenance & servicing costs" },
  { code: 502, name: "Cleaning Costs", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Expenses incurred for cleaning and maintaining the cleanliness of business premises and facilities." },
  { code: 504, name: "Security Costs", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Costs for security services and security related systems." },
  { code: 510, name: "Staff Training and Development", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Courses, certifications" },
  { code: 520, name: "Amenities", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Tea, coffee, kitchen supplies, meals" },
  {
    code: 530,
    name: "Subcontractor Payments",
    type: "EXPENSE",
    gstTreatment: "GST_ON_EXPENSES",
    description: "Depends on whether GST is charged",
    requiresVerification: true,
    taxNote:
      "THE SUPPLIED CHART GIVES TWO TREATMENTS FOR THIS ACCOUNT — 'GST on Expenses / GST Free' — and an account can carry only one. GST on Expenses was taken, since a GST-registered subcontractor charges GST. A subcontractor who is NOT registered charges none, and those transactions must have their GST cleared individually or 1B will be overstated. This account also feeds the TPAR. RESOLVE with the registered advisor.",
  },
  { code: 540, name: "Telephone and Internet", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Mobile and internet for business" },
  { code: 550, name: "Tools and Equipment Purchases", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Tradie tools, laptops" },
  { code: 551, name: "Tools (Replacements, Hand Held)", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Costs of replacing small handheld tools used in operations." },
  { code: 552, name: "Closing Stock", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Closing Stock" },
  { code: 560, name: "Travel and Accommodation", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Flights, accommodation (domestic)" },
  { code: 570, name: "Hire Charges", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Temporary hire" },

  // ------------------------------------------- Payroll, tax and finance
  { code: 580, name: "Taxation", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Taxation & GST payments" },
  { code: 600, name: "Wages & Salaries", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "Employee wages and salaries" },
  { code: 605, name: "Employee Long Service Leave", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Long service leave" },
  { code: 610, name: "Superannuation", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "No GST" },
  { code: 615, name: "Protective Clothing", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Uniform, protective clothing, PPE" },
  { code: 620, name: "Private Expenses", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "Non-deductible, private use, drawings" },
  { code: 630, name: "PAYG Withholding Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Amounts Withheld from Employee Wages & Salaries, Payable to the ATO." },
  { code: 640, name: "PAYG Instalments", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Pre-paid income tax" },
  {
    code: 650,
    name: "Loan Repayments (Principal)",
    type: "EXPENSE",
    gstTreatment: "BAS_EXCLUDED",
    description: "Principal only, no GST",
    requiresVerification: true,
    taxNote:
      "TYPED AS AN EXPENSE PER THE SUPPLIED CHART ('Other Expense'). A principal repayment is not an expense — it reduces a liability. Posting it here overstates expenses on the P&L, understates profit, and leaves the loan balance on the balance sheet unchanged. Consider retyping to LIABILITY. CONFIRM with the registered advisor.",
  },
  { code: 660, name: "Stamp Duty", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "No GST on stamp duty" },
  { code: 670, name: "Some Government Charges", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "ASIC fees, council rates (generally GST-free)" },

  // ---------------------------------------------------------------- Assets
  { code: 700, name: "Transfers", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Bank transfers" },
  {
    code: 701,
    name: "Cash at Bank",
    type: "ASSET",
    gstTreatment: "BAS_EXCLUDED",
    description: "Primary operating bank account",
    isCashAtBank: true,
  },
  { code: 719, name: "Cash on Hand", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Physical cash held on premises" },
  { code: 720, name: "GST Receivable", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "GST credits claimable from ATO" },
  { code: 725, name: "Stock on Hand", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Stock on Hand" },
  { code: 727, name: "Work in Progress", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Work in Progress" },
  { code: 790, name: "Security Deposits", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Lease bonds and deposits held" },

  // ----------------------------------------------------------- Liabilities
  { code: 804, name: "Credit Card", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Business credit card control account" },
  { code: 810, name: "GST Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "GST collected on sales, payable to the ATO" },
  { code: 840, name: "Income Tax Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Income tax owed to the ATO" },
  { code: 850, name: "Director Loan", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Amounts owed to/from directors" },
  { code: 860, name: "Beneficiary Loan", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Amounts owed to/from beneficiaries" },
  { code: 865, name: "Unit Holders Loan", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Amounts owed to/from unit holders" },

  // --------------------------------------------------------------- Equity
  { code: 900, name: "Owner's Equity - Opening", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Opening sole trader capital" },
  { code: 902, name: "Share Capital", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Shareholder capital invested" },
  { code: 903, name: "Unit Capital", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Unitholder capital invested" },
  { code: 904, name: "Settlement Sum", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Initial trust settlement amount from the trust deed" },
  { code: 910, name: "Retained Earnings - Opening", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Prior year accumulated profits" },
  { code: 920, name: "Current Year Earnings", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Current year net profit/loss" },
  { code: 930, name: "Drawings", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Owner withdrawals / private use" },
  { code: 932, name: "Dividends Paid", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Shareholder dividends" },
  {
    code: 935,
    name: "Income Tax Expense",
    type: "EQUITY",
    gstTreatment: "BAS_EXCLUDED",
    description: "Company tax expense for the year",
    requiresVerification: true,
    taxNote:
      "TYPED AS EQUITY PER THE SUPPLIED CHART. Income tax expense is normally an EXPENSE. Typed as equity it never appears on the P&L and sits on the balance sheet instead, so reported profit is stated before tax. If that is deliberate, clear this flag. CONFIRM with the registered advisor.",
  },
  { code: 936, name: "Partners Drawings", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Partner withdrawals / private use" },
  { code: 937, name: "Contribution", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Partner contributions into the business" },
  { code: 938, name: "Transfer In", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Funds transferred into the business" },
];

/**
 * Sentinel and control codes the engine depends on.
 *
 * These are the codes that CODE, not a person, relies on being present and
 * meaning what they say. Every one of them moved when the chart was replaced
 * on 2026-09-16 — several to numbers that previously meant something else
 * entirely (320 was Subcontractor Payments and is now Bank Fees; 840 was the
 * loan account and is now Income Tax Payable). Change a value here and the
 * report that reads it changes with it, silently. Grep before editing.
 */
export const CODE_UNKNOWN = 0;
export const CODE_SUSPENSE = 1;
/** Movements between the client's own bank accounts. */
export const CODE_TRANSFER = 700;
/** The bank side of every accepted bank transaction. NOT in the supplied chart. */
export const CODE_CASH_AT_BANK = 701;
/** The credit-card side of every accepted card transaction. NOT in the supplied chart. */
export const CODE_CREDIT_CARD = 804;
export const CODE_GST_PAYABLE = 810;
/** Feeds BAS label W1. */
export const CODE_WAGES = 600;
/** Feeds BAS label W2. */
export const CODE_PAYG_WITHHOLDING = 630;
/** Feeds the TPAR. */
export const CODE_SUBCONTRACTORS = 530;
export const CODE_BANK_FEES = 320;
export const CODE_INTEREST_CHARGED = 400;
export const CODE_INTEREST_INCOME = 202;
export const CODE_LOAN_PRINCIPAL = 650;
export const CODE_SUPERANNUATION = 610;
export const CODE_INCOME_TAX_PAYABLE = 840;

/** Firm-created accounts must use codes above this. Defined once, in shared. */
export { CUSTOM_ACCOUNT_CODE_FLOOR } from "@/shared/account-rules";
