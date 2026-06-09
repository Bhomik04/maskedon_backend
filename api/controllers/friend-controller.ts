import { Request, Response } from "express";
import {
  createFriendRequest,
  findFriendship,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriendship,
  getUserFriends,
  getPendingRequests,
  getSentRequests,
  getFriendSuggestions,
  getFriendCount,
  getMutualFriends,
} from "../../dblayer/friend-queries";
import { getPublicProfile } from "../../dblayer/user-queries";
import { createNotification } from "../../dblayer/notification-queries";
import { isBlockedEitherWay } from "../../dblayer/block-queries";

// POST /api/v1/friends/:userId  — send friend request
export async function sendRequest(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;

  if (me === targetId) {
    res.status(400).json({
      success: false,
      error: { code: "SELF_FRIEND", message: "You cannot friend yourself" },
    });
    return;
  }

  const target = await getPublicProfile(targetId);
  if (!target) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    });
    return;
  }

  // Prevent friend requests between blocked users
  const blocked = await isBlockedEitherWay(me, targetId);
  if (blocked) {
    res.status(403).json({
      success: false,
      error: { code: "BLOCKED", message: "Cannot send friend request to this user" },
    });
    return;
  }

  const existing = await findFriendship(me, targetId);
  if (existing) {
    if (existing.status === "accepted") {
      res.status(409).json({
        success: false,
        error: { code: "ALREADY_FRIENDS", message: "You are already friends" },
      });
      return;
    }
    if (existing.status === "pending") {
      // If the other person already sent us a request, tell the user to accept it explicitly
      if (existing.addressee_id === me) {
        res.status(409).json({
          success: false,
          error: {
            code: "MUTUAL_PENDING",
            message: "This user already sent you a friend request. Accept it from your notifications.",
          },
        });
        return;
      }
      res.status(409).json({
        success: false,
        error: { code: "ALREADY_PENDING", message: "Friend request already sent" },
      });
      return;
    }
    // If rejected, remove old row and allow re-request
    await removeFriendship(existing.id);
  }

  const friendship = await createFriendRequest(me, targetId);

  createNotification(
    targetId,
    "friend_request",
    "New friend request",
    "Someone sent you a friend request",
    me,
    "user"
  ).catch(() => {});

  res.status(201).json({ success: true, data: { friendship } });
}

// PATCH /api/v1/friends/:userId/accept  — accept incoming request
export async function accept(req: Request, res: Response) {
  const me = req.user!.userId;
  const fromUserId = req.params.userId as string;

  const existing = await findFriendship(me, fromUserId);
  if (!existing || existing.status !== "pending" || existing.addressee_id !== me) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "No pending friend request from this user" },
    });
    return;
  }

  await acceptFriendRequest(existing.id);

  createNotification(
    fromUserId,
    "friend_accepted",
    "Friend request accepted",
    "Someone accepted your friend request",
    me,
    "user"
  ).catch(() => {});

  res.json({ success: true, data: { message: "Friend request accepted" } });
}

// PATCH /api/v1/friends/:userId/reject  — reject incoming request
export async function reject(req: Request, res: Response) {
  const me = req.user!.userId;
  const fromUserId = req.params.userId as string;

  const existing = await findFriendship(me, fromUserId);
  if (!existing || existing.status !== "pending" || existing.addressee_id !== me) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "No pending friend request from this user" },
    });
    return;
  }

  await rejectFriendRequest(existing.id);
  res.json({ success: true, data: { message: "Friend request rejected" } });
}

// DELETE /api/v1/friends/:userId  — unfriend or cancel pending request
export async function unfriend(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;

  const existing = await findFriendship(me, targetId);
  if (!existing) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "No friendship found" },
    });
    return;
  }

  await removeFriendship(existing.id);
  res.json({ success: true, data: { message: "Friendship removed" } });
}

// GET /api/v1/friends/me  — my friends list
export async function myFriends(req: Request, res: Response) {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
  const result = await getUserFriends(req.user!.userId, page, limit);
  res.json({ success: true, data: result });
}

// GET /api/v1/friends/me/pending  — my incoming pending requests
export async function myPendingRequests(req: Request, res: Response) {
  const pending = await getPendingRequests(req.user!.userId);
  res.json({ success: true, data: { requests: pending } });
}

// GET /api/v1/friends/:userId/list  — a user's friends (public)
export async function listUserFriends(req: Request, res: Response) {
  const userId = req.params.userId as string;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 20));
  const result = await getUserFriends(userId, page, limit);
  res.json({ success: true, data: result });
}

// GET /api/v1/friends/:userId/status  — friendship status with a user
export async function friendshipStatus(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;
  const existing = await findFriendship(me, targetId);

  if (!existing) {
    res.json({ success: true, data: { status: "none" } });
    return;
  }

  // Determine who is the requester for context
  const direction = existing.requester_id === me ? "outgoing" : "incoming";
  res.json({ success: true, data: { status: existing.status, direction, friendshipId: existing.id } });
}

// GET /api/v1/friends/:userId/mutual  — mutual friends with a user
export async function mutual(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;
  const mutuals = await getMutualFriends(me, targetId);
  res.json({ success: true, data: { mutuals, count: mutuals.length } });
}

// GET /api/v1/friends/me/count  — my friend count
export async function myFriendCount(req: Request, res: Response) {
  const count = await getFriendCount(req.user!.userId);
  res.json({ success: true, data: { count } });
}

// GET /api/v1/friends/me/sent  — requests I sent that are still pending
export async function mySentRequests(req: Request, res: Response) {
  const sent = await getSentRequests(req.user!.userId);
  res.json({ success: true, data: { requests: sent } });
}

// GET /api/v1/friends/me/suggestions  — people you may know
export async function friendSuggestions(req: Request, res: Response) {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string, 10) || 12));
  const suggestions = await getFriendSuggestions(req.user!.userId, limit);
  res.json({ success: true, data: { suggestions } });
}
