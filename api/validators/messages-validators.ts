import { z } from "zod/v4";

export const startConversationSchema = z.object({
  event_id: z.string().uuid(),
});

export const sendMessageSchema = z.object({
  body: z.string().min(1, "Message cannot be empty").max(2000),
});

export const createAnnouncementSchema = z.object({
  body: z.string().min(1, "Announcement cannot be empty").max(2000),
});