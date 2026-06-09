import { Request, Response } from "express";
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
} from "../../dblayer/notification-queries";
import { emitUnreadCountToUser } from "../lib/websocket";
import { io } from "../server";

// GET /api/v1/notifications
export async function list(req: Request, res: Response) {
  const userId = req.user!.userId;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string, 10) || 20));

  const result = await getUserNotifications(userId, page, limit);
  res.json({ success: true, data: result });
}

// GET /api/v1/notifications/unread-count
export async function unreadCount(req: Request, res: Response) {
  const count = await getUnreadCount(req.user!.userId);
  res.json({ success: true, data: { count } });
}

// PATCH /api/v1/notifications/:notificationId/read
export async function read(req: Request, res: Response) {
  try {
    const notificationId = req.params.notificationId as string;
    const userId = req.user!.userId;
    await markAsRead(notificationId, userId);
    const count = await getUnreadCount(userId);
    emitUnreadCountToUser(io, userId, count);
    res.json({ success: true, data: { message: "Notification marked as read" } });
  } catch {
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Failed to mark notification as read" } });
  }
}

// PATCH /api/v1/notifications/read-all
export async function readAll(req: Request, res: Response) {
  try {
    const userId = req.user!.userId;
    await markAllAsRead(userId);
    emitUnreadCountToUser(io, userId, 0);
    res.json({ success: true, data: { message: "All notifications marked as read" } });
  } catch {
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Failed to mark notifications as read" } });
  }
}

// DELETE /api/v1/notifications/:notificationId
export async function remove(req: Request, res: Response) {
  try {
    const notificationId = req.params.notificationId as string;
    await deleteNotification(notificationId, req.user!.userId);
    res.json({ success: true, data: { message: "Notification deleted" } });
  } catch {
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Failed to delete notification" } });
  }
}

// DELETE /api/v1/notifications
export async function removeAll(req: Request, res: Response) {
  try {
    await deleteAllNotifications(req.user!.userId);
    res.json({ success: true, data: { message: "All notifications deleted" } });
  } catch {
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Failed to delete notifications" } });
  }
}
