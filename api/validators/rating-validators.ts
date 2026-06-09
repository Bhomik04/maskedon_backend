import { z } from "zod/v4";

export const crowdRatingSchema = z.object({
  score: z.number().int().min(1, "Score must be 1-5").max(5, "Score must be 1-5"),
});

export type CrowdRatingInput = z.infer<typeof crowdRatingSchema>;
