import { Request, Response } from "express";
import { findEventById } from "../../dblayer/event-queries";
import { findExistingRequest } from "../../dblayer/request-queries";
import { isBlockedEitherWay } from "../../dblayer/block-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";
import { io } from "../server";
import { emitMessageToUser, emitMessageUnreadCountToUser } from "../lib/websocket";
import {
  createConversation,
  createMessage,
  createEventAnnouncement,
  findConversationForUser,
  getConversationMessages,
  getEventAnnouncementRecipients,
  getUnreadMessageCount,
  listConversationsForUser,
  listEventAnnouncements,
  markConversationRead,
} from "../../dblayer/messaging-queries";
import { createAnnouncementSchema, sendMessageSchema, startConversationSchema } from "../validators/messages-validators";

function forbidden(res: Response, code: string, message: string) {
  res.status(403).json({ success: false, error: { code, message } });
}

export async function listConversations(req: Request, res: Response) {
  const conversations = await listConversationsForUser(req.user!.userId);
  res.json({ success: true, data: { conversations } });
}

export async function startConversation(req: Request, res: Response) {
  const parsed = startConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" } });
    return;
  }

  const userId = req.user!.userId;
  const event = await findEventById(parsed.data.event_id);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  if (event.host_id === userId) {
    forbidden(res, "FORBIDDEN", "Hosts can reply inside existing conversations");
    return;
  }

  const request = await findExistingRequest(event.id, userId);
  if (!request || request.status === "withdrawn") {
    res.status(403).json({ success: false, error: { code: "ANTI_SPAM_GATED", message: "You can only message after a join request exists" } });
    return;
  }

  if (await isBlockedEitherWay(userId, event.host_id)) {
    res.status(403).json({ success: false, error: { code: "BLOCKED", message: "Messaging is unavailable" } });
    return;
  }

  const conversation = await createConversation(event.id, userId, event.host_id);
  res.status(201).json({ success: true, data: { conversation } });
}

export async function getMessages(req: Request, res: Response) {
  const conversation = await findConversationForUser(req.params.conversationId as string, req.user!.userId);
  if (!conversation) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 50));
  const result = await getConversationMessages(conversation.id, page, limit);
  res.json({ success: true, data: { conversation, ...result } });
}

export async function sendMessage(req: Request, res: Response) {
  const conversation = await findConversationForUser(req.params.conversationId as string, req.user!.userId);
  if (!conversation) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
    return;
  }

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" } });
    return;
  }

  const senderId = req.user!.userId;
  const recipientId = conversation.host_id === senderId ? conversation.guest_id : conversation.host_id;

  if (await isBlockedEitherWay(senderId, recipientId)) {
    res.status(403).json({ success: false, error: { code: "BLOCKED", message: "Messaging is unavailable" } });
    return;
  }

  const message = await createMessage(conversation.id, senderId, parsed.data.body);
  const unreadCount = await getUnreadMessageCount(recipientId);

  emitMessageToUser(io, recipientId, {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    body: message.body,
    created_at: message.created_at,
    read_at: message.read_at,
  });
  emitMessageToUser(io, senderId, {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    body: message.body,
    created_at: message.created_at,
    read_at: message.read_at,
  });
  emitMessageUnreadCountToUser(io, recipientId, unreadCount);

  createNotificationWithSocket(
    recipientId,
    "message",
    "New message",
    parsed.data.body.slice(0, 140),
    conversation.id,
    "conversation"
  ).catch(() => {});

  res.status(201).json({ success: true, data: { message } });
}

export async function markRead(req: Request, res: Response) {
  const conversation = await findConversationForUser(req.params.conversationId as string, req.user!.userId);
  if (!conversation) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Conversation not found" } });
    return;
  }

  const userId = req.user!.userId;
  await markConversationRead(conversation.id, userId);
  const count = await getUnreadMessageCount(userId);
  emitMessageUnreadCountToUser(io, userId, count);
  res.json({ success: true, data: { message: "Conversation marked as read" } });
}

export async function unreadCount(req: Request, res: Response) {
  const count = await getUnreadMessageCount(req.user!.userId);
  res.json({ success: true, data: { count } });
}

export async function listAnnouncements(req: Request, res: Response) {
  const event = await findEventById(req.params.eventId as string);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  const userId = req.user!.userId;
  const isHost = event.host_id === userId;
  const request = await findExistingRequest(event.id, userId);
  const isApprovedAttendee = request?.status === "approved" || false;

  if (!isHost && !isApprovedAttendee) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only approved attendees can view announcements" } });
    return;
  }

  const announcements = await listEventAnnouncements(event.id);
  res.json({ success: true, data: { announcements } });
}

export async function createAnnouncement(req: Request, res: Response) {
  const event = await findEventById(req.params.eventId as string);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  if (event.host_id !== req.user!.userId) {
    forbidden(res, "FORBIDDEN", "Only the host can post announcements");
    return;
  }

  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" } });
    return;
  }

  const announcement = await createEventAnnouncement(event.id, req.user!.userId, parsed.data.body);
  const recipients = await getEventAnnouncementRecipients(event.id, req.user!.userId);

  await Promise.all(
    recipients.map((recipientId) =>
      createNotificationWithSocket(
        recipientId,
        "announcement",
        `New update for ${event.title}`,
        parsed.data.body.slice(0, 140),
        event.id,
        "event"
      ).catch(() => {})
    )
  );

  res.status(201).json({ success: true, data: { announcement } });
}