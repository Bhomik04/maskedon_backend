import { z } from "zod/v4";

export const submitBugReportSchema = z.object({
  category: z.string().min(1, "Category is required").max(100),
  severity: z.enum(["low", "medium", "high", "critical"]),
  affected_feature: z.string().max(200).optional(),
  steps_to_reproduce: z.string().min(10, "Please describe the steps to reproduce the bug").max(5000),
  expected_behavior: z.string().min(5, "Please describe the expected behavior").max(2000),
  actual_behavior: z.string().min(5, "Please describe what actually happened").max(2000),
});

export type SubmitBugReportInput = z.infer<typeof submitBugReportSchema>;
