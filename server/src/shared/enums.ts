/**
 * Domain enums, re-exported for the frontend.
 *
 * The generated Prisma client is a backend build artifact. The UI needs the
 * enum *types* — a badge has to know what an `EntityType` can be — so they are
 * re-exported once, here, and nothing under `app/`, `features/` or `ui/` ever
 * imports from `@/generated`.
 *
 * Types only, so this file compiles away entirely and carries no Prisma runtime
 * into the browser bundle.
 */

export type {
  AccountType,
  AssetCategory,
  BankAccountKind,
  BankSource,
  BasFrequency,
  BeneficiaryKind,
  ClassificationSource,
  DepreciationMethod,
  EntityType,
  FeedConnectionStatus,
  FeedRequestStatus,
  GstBasis,
  GstTreatment,
  ImportStatus,
  JournalSource,
  LoanFrequency,
  LoanStatus,
  LoanType,
  MatchType,
  TrusteeKind,
  TxStatus,
  UserRole,
} from "@/generated/prisma";
