import { z } from "zod/v4";

export const updateProfileSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name cannot be empty")
    .max(100, "Display name must be at most 100 characters")
    .optional(),
  bio: z.string().max(500, "Bio must be at most 500 characters").optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const pushTokenSchema = z.object({
  token: z.string().min(1, "Token is required").max(512, "Token too long"),
  platform: z.enum(["fcm", "apns"]),
});

export type PushTokenInput = z.infer<typeof pushTokenSchema>;
