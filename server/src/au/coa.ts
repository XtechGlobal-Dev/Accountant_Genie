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
 * Codes follow the conventional AU numbering that Xero, MYOB and most local
 * practices share, so an accountant reading a report recognises them on sight.
 *
 * Ranges:
 *     0–1    Sentinel / control accounts
 *   200–299  Income
 *   300–399  Direct costs (COGS)
 *   400–599  Operating expenses
 *   600–799  Assets
 *   800–879  Liabilities
 *   880–969  Equity
 *   970–999  Control accounts
 *
 * Custom accounts created by a firm must use codes above 1000.
 */
export const AU_CHART_OF_ACCOUNTS: SeedAccount[] = [
  // ------------------------------------------------------------- Sentinels
  // Two distinct states, deliberately. "Unknown" means the engine could not
  // classify it. "Suspense" means a human parked it pending information from
  // the client. Collapsing them loses the reason a transaction is unresolved.
  {
    code: 0,
    name: "Unknown",
    type: "UNKNOWN",
    gstTreatment: "UNALLOCATED",
    description: "Could not be categorised automatically — requires human review",
  },
  {
    code: 1,
    name: "Suspense",
    type: "UNKNOWN",
    gstTreatment: "UNALLOCATED",
    description: "Parked pending information from the client",
  },

  // ---------------------------------------------------------------- Income
  { code: 200, name: "Sales", type: "INCOME", gstTreatment: "GST_ON_INCOME", description: "Main business sales" },
  { code: 201, name: "Sales - GST Free", type: "INCOME", gstTreatment: "GST_FREE_INCOME", description: "Export sales, healthcare, basic foods" },
  {
    code: 202,
    name: "Interest Income",
    type: "INCOME",
    gstTreatment: "INPUT_TAXED",
    description: "Interest earned on bank accounts and term deposits",
    requiresVerification: true,
    taxNote:
      "Interest is a financial supply and therefore input taxed, not GST-free. Input-taxed and GST-free differ on the BAS (GST-free income reports at G1; input-taxed sales are backed out at G4). Some practitioners code interest as GST Free Income. CONFIRM with the registered advisor before GA — an error here misstates G1 for every client holding a bank account.",
  },
  {
    code: 203,
    name: "Rebates & Grants",
    type: "INCOME",
    gstTreatment: "BAS_EXCLUDED",
    description: "Rebates, incentive payments and government grants",
    requiresVerification: true,
    taxNote:
      "Not every grant is outside the GST system: a grant paid for a supply (something the client has to do in return) is a taxable sale at G1/1A, and fuel tax credits report at their own label, not here. BAS_EXCLUDED is the safe default only while the advisor confirms which grants this firm's clients receive.",
  },
  {
    code: 204,
    name: "Rent Received - Commercial",
    type: "INCOME",
    gstTreatment: "GST_ON_INCOME",
    description: "Rent from commercial property (GST applies)",
  },
  {
    code: 205,
    name: "Rent Received - Residential",
    type: "INCOME",
    gstTreatment: "INPUT_TAXED",
    description: "Residential rent — input taxed, no GST charged",
  },
  { code: 260, name: "Other Income", type: "INCOME", gstTreatment: "GST_ON_INCOME", description: "Income outside normal business activities" },

  // ---------------------------------------------------------- Direct costs
  { code: 300, name: "Opening Stock", type: "COGS", gstTreatment: "BAS_EXCLUDED" },
  { code: 310, name: "Cost of Goods Sold", type: "COGS", gstTreatment: "GST_ON_EXPENSES", description: "Direct cost of goods sold to customers" },
  { code: 320, name: "Subcontractor Payments", type: "COGS", gstTreatment: "GST_ON_EXPENSES", description: "Payments to subcontractors — reportable on TPAR" },
  { code: 325, name: "Direct Wages", type: "COGS", gstTreatment: "BAS_EXCLUDED", description: "Wages directly attributable to production" },
  { code: 328, name: "Purchases", type: "COGS", gstTreatment: "GST_ON_EXPENSES", description: "Goods bought for resale or use in production" },
  { code: 330, name: "Freight & Courier", type: "COGS", gstTreatment: "GST_ON_EXPENSES" },
  { code: 335, name: "Closing Stock", type: "COGS", gstTreatment: "BAS_EXCLUDED" },

  // A refund given to a customer reduces sales, so it lives with income on
  // the income side of the chart: a debit here is negative income, which
  // reduces G1 and 1A instead of inflating G11 and 1B. A refund RECEIVED from
  // a supplier is a credit against the expense account it reverses.
  { code: 290, name: "Customer Refunds", type: "INCOME", gstTreatment: "GST_ON_INCOME", description: "Refunds given to customers — reduces sales, G1 and 1A" },

  // ---------------------------------------------------- Operating expenses
  { code: 400, name: "Interest Charges", type: "EXPENSE", gstTreatment: "INPUT_TAXED", description: "Interest on loans and overdrafts — a financial supply" },
  { code: 404, name: "Bank Fees", type: "EXPENSE", gstTreatment: "INPUT_TAXED", description: "Account keeping and transaction fees — input taxed, no GST credit" },
  { code: 408, name: "Merchant & Payment Processing Fees", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Stripe, Square, EFTPOS and similar merchant fees" },
  { code: 412, name: "Accounting & Bookkeeping", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 416, name: "Advertising & Marketing", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 420, name: "Business Insurance Premiums", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 424, name: "Cleaning", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 429, name: "General Expenses", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Miscellaneous business expenses" },
  { code: 433, name: "Computer Equipment & Software", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Software subscriptions and low-value hardware" },
  { code: 437, name: "Consulting & Professional Fees", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 441, name: "Legal Fees", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 445, name: "Entertainment", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Client entertainment — check FBT and deductibility" },
  { code: 449, name: "Motor Vehicle Expenses", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Fuel, servicing, tyres and running costs" },
  { code: 453, name: "Light, Power & Heating", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Electricity and gas" },
  { code: 457, name: "Telephone & Internet", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 461, name: "Printing & Stationery", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 465, name: "Rates & Land Taxes", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Council rates and land tax — GST free" },
  { code: 469, name: "Rent", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES", description: "Commercial premises rent" },
  { code: 473, name: "Repairs & Maintenance", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 477, name: "Wages & Salaries", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "Gross wages — reported at W1, never at 1B" },
  { code: 478, name: "Superannuation", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "Employer super guarantee contributions" },
  { code: 480, name: "Staff Training", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 482, name: "Staff Amenities", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 485, name: "Subscriptions & Memberships", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  { code: 489, name: "Travel - National", type: "EXPENSE", gstTreatment: "GST_ON_EXPENSES" },
  {
    code: 493,
    name: "Travel - International",
    type: "EXPENSE",
    gstTreatment: "GST_FREE_EXPENSES",
    description: "International airfares are GST free; overseas accommodation and meals are outside the GST system",
    requiresVerification: true,
    taxNote:
      "International air travel is GST-free (reports at G11). Accommodation, meals and transport consumed overseas are not a taxable supply in Australia at all, which some practitioners code BAS_EXCLUDED rather than GST_FREE. The difference is G11 only — never 1B — but the advisor decides which this firm reports.",
  },
  { code: 499, name: "Licences & Permits", type: "EXPENSE", gstTreatment: "GST_FREE_EXPENSES", description: "Government licences and permits — generally GST free" },
  { code: 505, name: "Income Tax Expense", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED" },
  {
    code: 510,
    name: "Insurance - Workers Compensation",
    type: "EXPENSE",
    gstTreatment: "GST_ON_EXPENSES",
    requiresVerification: true,
    taxNote:
      "Workers compensation is a state scheme and the GST treatment of premiums differs between them (some insurer-issued policies carry GST; some statutory scheme charges do not). The firm's state is on the Firm record — the advisor confirms the treatment for it.",
  },
  { code: 515, name: "Depreciation", type: "EXPENSE", gstTreatment: "BAS_EXCLUDED", description: "Non-cash depreciation of fixed assets" },

  // ---------------------------------------------------------------- Assets
  { code: 610, name: "Accounts Receivable", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },
  { code: 620, name: "Prepayments", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },
  { code: 630, name: "Inventory", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },
  { code: 701, name: "Cash at Bank", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Primary operating bank account", isCashAtBank: true },
  { code: 705, name: "Cash on Hand", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },
  { code: 710, name: "Office Equipment", type: "ASSET", gstTreatment: "GST_ON_CAPITAL", description: "Capital acquisition — reports at G10" },
  { code: 711, name: "Less Accumulated Depreciation on Office Equipment", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },
  { code: 720, name: "Motor Vehicles", type: "ASSET", gstTreatment: "GST_ON_CAPITAL", description: "Capital acquisition — reports at G10" },
  { code: 721, name: "Less Accumulated Depreciation on Motor Vehicles", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },
  { code: 740, name: "PAYG Instalments Paid", type: "ASSET", gstTreatment: "BAS_EXCLUDED" },

  // ----------------------------------------------------------- Liabilities
  { code: 800, name: "Accounts Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED" },
  { code: 804, name: "Credit Card", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED" },
  { code: 820, name: "GST Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Net GST control account" },
  { code: 825, name: "PAYG Withholding Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Tax withheld from employee wages — W2" },
  { code: 830, name: "Income Tax Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED" },
  { code: 835, name: "Superannuation Payable", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED" },
  { code: 840, name: "Loan Account", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED", description: "Bank or equipment finance principal — never expensed" },
  { code: 850, name: "Director Loan Account", type: "LIABILITY", gstTreatment: "BAS_EXCLUDED" },

  // --------------------------------------------------------------- Equity
  { code: 880, name: "Owner's Drawings", type: "EQUITY", gstTreatment: "BAS_EXCLUDED", description: "Funds drawn by the owner for private use" },
  { code: 890, name: "Owner's Contributions", type: "EQUITY", gstTreatment: "BAS_EXCLUDED" },
  { code: 900, name: "Share Capital", type: "EQUITY", gstTreatment: "BAS_EXCLUDED" },
  { code: 960, name: "Retained Earnings", type: "EQUITY", gstTreatment: "BAS_EXCLUDED" },

  // ------------------------------------------------------ Control accounts
  { code: 977, name: "Tracking Transfers", type: "ASSET", gstTreatment: "BAS_EXCLUDED", description: "Movements between the client's own bank accounts" },
];

/** Sentinel and control codes the engine depends on. */
export const CODE_UNKNOWN = 0;
export const CODE_SUSPENSE = 1;
export const CODE_TRANSFER = 977;
export const CODE_CASH_AT_BANK = 701;
export const CODE_GST_PAYABLE = 820;
export const CODE_WAGES = 477;
export const CODE_PAYG_WITHHOLDING = 825;
export const CODE_SUBCONTRACTORS = 320;
export const CODE_BANK_FEES = 404;
export const CODE_INTEREST_CHARGED = 400;
export const CODE_INTEREST_INCOME = 202;
export const CODE_LOAN_PRINCIPAL = 840;

/** Firm-created accounts must use codes above this. Defined once, in shared. */
export { CUSTOM_ACCOUNT_CODE_FLOOR } from "@/shared/account-rules";

/** Accounts that may never be posted to by a finished, reviewed transaction. */
export const SENTINEL_CODES: readonly number[] = [CODE_UNKNOWN, CODE_SUSPENSE];
