import { z } from "zod/v4";

export const reportSchema = z.object({
  target_type: z.enum(["user", "event", "photo"]),
  target_id: z.string().uuid("Please select a valid item to report"),
  reason: z.enum(["spam", "harassment", "fake_event", "inappropriate_content", "underage", "other"]),
  description: z.string().max(1000, "Description must be at most 1000 characters").optional(),
});

export type ReportInput = z.infer<typeof reportSchema>;
