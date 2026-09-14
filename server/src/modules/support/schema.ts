import { z } from "zod";

export const SUPPORT_CATEGORIES = ["question", "bug", "feature", "billing"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  question: "Ask a question",
  bug: "Report a bug",
  feature: "Suggest a feature",
  billing: "Billing & plan",
};

export const SupportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(3, "Say what it is about").max(120),
  message: z.string().trim().min(10, "A little more detail helps us help you").max(4000),
  /** The page the person was on — pasted in by the widget, never typed. */
  page: z.string().trim().max(300).optional(),
});

export type SupportRequestInput = z.infer<typeof SupportRequestSchema>;

export function supportRequestFromForm(form: FormData) {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : undefined;
  };
  return SupportRequestSchema.safeParse({
    category: text("category"),
    subject: text("subject"),
    message: text("message"),
    page: text("page"),
  });
}
