import { z } from "zod";
import { GstTreatmentEnum } from "@/server/modules/accounts/schema";

/** Input contracts for review actions and Coding Memory. */

export const RememberEnum = z.enum(["NONE", "CLIENT", "FIRM"]);
export const MatchTypeEnum = z.enum(["EXACT", "CONTAINS"]);

export const RecodeSchema = z.object({
  accountId: z.string().trim().min(1, "Choose an account").max(64),
  /** Omit to take the account's own treatment. */
  gstTreatment: GstTreatmentEnum.optional(),
  remember: RememberEnum.default("NONE"),
  /** The text the memory rule matches on; defaults to the normalised description. */
  pattern: z.string().trim().min(2, "A pattern needs at least two characters").max(200).optional(),
  matchType: MatchTypeEnum.default("EXACT"),
  subcontractorId: z.string().trim().max(64).optional(),
});

export const ExcludeSchema = z.object({
  reason: z.string().trim().min(1, "Say why it is excluded").max(200),
});

export const MemoryRuleUpdateSchema = z.object({
  pattern: z.string().trim().min(2, "A pattern needs at least two characters").max(200),
  matchType: MatchTypeEnum,
  accountId: z.string().trim().min(1, "Choose an account").max(64),
  gstTreatment: GstTreatmentEnum,
});

export const IdListSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(500);

export type RecodeInput = z.infer<typeof RecodeSchema>;
export type ExcludeInput = z.infer<typeof ExcludeSchema>;
export type MemoryRuleUpdateInput = z.infer<typeof MemoryRuleUpdateSchema>;
