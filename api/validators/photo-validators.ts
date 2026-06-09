import { z } from "zod/v4";

export const uploadPhotoSchema = z.object({
  event_id: z.string().uuid("Invalid event link. Please go back and try again.").optional(),
  caption: z.string().max(500).optional(),
  global_visibility: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "true")
    .optional()
    .default(false),
  friends_only: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((v) => v === true || v === "true")
    .optional()
    .default(false),
});

export const addCommentSchema = z.object({
  comment_text: z
    .string()
    .min(1, "Comment text is required")
    .max(2000, "Comment must be at most 2000 characters"),
  parent_comment_id: z.string().uuid("Invalid parent comment ID").optional().nullable(),
});

export const editCommentSchema = z.object({
  comment_text: z
    .string()
    .min(1, "Comment text is required")
    .max(2000, "Comment must be at most 2000 characters"),
});

export type UploadPhotoInput = z.infer<typeof uploadPhotoSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type EditCommentInput = z.infer<typeof editCommentSchema>;

export const editCaptionSchema = z.object({
  caption: z.string().max(500).optional().nullable(),
});

export type EditCaptionInput = z.infer<typeof editCaptionSchema>;
