import { z } from "zod";
import { CalendarDateSchema } from "@/server/modules/ledger/schema";
import { parseBasisPoints, parseCents } from "@/shared/money";

/** Input contracts for the asset register. Dollars and percentages are parsed at this edge. */

const money = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const cents = parseCents(v);
    if (cents === null || cents <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in dollars and cents" });
      return z.NEVER;
    }
    return cents;
  });

/** Blank is absence; anything typed must be a non-negative amount. */
const optionalMoney = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const cents = parseCents(v);
    if (cents === null || cents < 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in dollars and cents, or leave blank" });
      return z.NEVER;
    }
    return cents;
  });

export const AssetCategoryEnum = z.enum([
  "COMPUTER_EQUIPMENT",
  "FURNITURE_FIXTURES",
  "OFFICE_EQUIPMENT",
  "TOOLS_EQUIPMENT",
  "MOTOR_VEHICLES",
  "PLANT_EQUIPMENT",
  "OTHER",
]);

export const AssetSchema = z.object({
  name: z.string().trim().min(1, "The asset needs a name").max(200),
  description: z.string().trim().max(300).optional(),
  category: AssetCategoryEnum,
  /** What was paid, GST included. Optional: the schedule never reads it. */
  totalCostCents: optionalMoney,
  gstCents: optionalMoney,
  /** The depreciable cost. */
  costCents: money,
  purchaseDate: CalendarDateSchema,
  method: z.enum(["PRIME_COST", "DIMINISHING_VALUE"]),
  /** Years, with up to two decimals: "2.5" → 30 months. */
  effectiveLifeMonths: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const hundredths = parseCents(v);
      if (hundredths === null || hundredths <= 0) {
        ctx.addIssue({ code: "custom", message: "Enter the effective life in years" });
        return z.NEVER;
      }
      const months = Math.round((hundredths * 12) / 100);
      if (months < 1 || months > 1200) {
        ctx.addIssue({ code: "custom", message: "Effective life must be between one month and 100 years" });
        return z.NEVER;
      }
      return months;
    }),
  privateUseBasisPoints: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return 0;
      const bps = parseBasisPoints(v);
      if (bps === null || bps > 10_000) {
        ctx.addIssue({ code: "custom", message: "Private use is a percentage from 0 to 100" });
        return z.NEVER;
      }
      return bps;
    }),
  accountId: z.string().trim().max(64).optional(),
  isCar: z.boolean(),
})
  .refine((v) => v.gstCents === null || v.totalCostCents === null || v.gstCents <= v.totalCostCents, {
    path: ["gstCents"],
    message: "GST cannot exceed the total cost",
  })
  .refine((v) => v.totalCostCents === null || v.costCents <= v.totalCostCents, {
    path: ["costCents"],
    message: "The acquisition cost cannot exceed the total cost",
  });

export const DisposeAssetSchema = z.object({
  disposedAt: CalendarDateSchema,
  disposalCents: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return 0;
      const cents = parseCents(v);
      if (cents === null || cents < 0) {
        ctx.addIssue({ code: "custom", message: "Enter the sale proceeds, or leave blank" });
        return z.NEVER;
      }
      return cents;
    }),
});

export type AssetInput = z.infer<typeof AssetSchema>;
export type DisposeAssetInput = z.infer<typeof DisposeAssetSchema>;

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export function assetFromForm(form: FormData) {
  return AssetSchema.safeParse({
    name: form.get("name"),
    description: text(form, "description"),
    category: form.get("category"),
    totalCostCents: text(form, "totalCost"),
    gstCents: text(form, "gst"),
    costCents: text(form, "cost"),
    purchaseDate: text(form, "purchaseDate"),
    method: form.get("method"),
    effectiveLifeMonths: text(form, "effectiveLifeYears"),
    privateUseBasisPoints: text(form, "privateUsePercent"),
    accountId: text(form, "accountId"),
    isCar: form.get("isCar") === "yes",
  });
}

export function disposeAssetFromForm(form: FormData) {
  return DisposeAssetSchema.safeParse({
    disposedAt: text(form, "disposedAt"),
    disposalCents: text(form, "proceeds"),
  });
}
