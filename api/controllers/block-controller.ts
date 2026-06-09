import { Request, Response } from "express";
import {
  createBlock,
  removeBlock,
  hasBlocked,
  isBlockedEitherWay,
  getBlockedUsers,
} from "../../dblayer/block-queries";
import { findFriendship, removeFriendship } from "../../dblayer/friend-queries";
import { getPublicProfile } from "../../dblayer/user-queries";

// POST /api/v1/blocks/:userId  — block a user
export async function blockUser(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;

  if (me === targetId) {
    res.status(400).json({
      success: false,
      error: { code: "SELF_BLOCK", message: "You cannot block yourself" },
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

  const alreadyBlocked = await hasBlocked(me, targetId);
  if (alreadyBlocked) {
    res.status(409).json({
      success: false,
      error: { code: "ALREADY_BLOCKED", message: "User is already blocked" },
    });
    return;
  }

  // Remove any existing friendship when blocking
  const friendship = await findFriendship(me, targetId);
  if (friendship) {
    await removeFriendship(friendship.id);
  }

  const block = await createBlock(me, targetId);
  res.status(201).json({ success: true, data: { block } });
}

// DELETE /api/v1/blocks/:userId  — unblock a user
export async function unblockUser(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;

  const removed = await removeBlock(me, targetId);
  if (!removed) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Block not found" },
    });
    return;
  }

  res.json({ success: true, data: { message: "User unblocked" } });
}

// GET /api/v1/blocks/:userId/status  — check block status with a user
export async function blockStatus(req: Request, res: Response) {
  const me = req.user!.userId;
  const targetId = req.params.userId as string;

  const iBlocked = await hasBlocked(me, targetId);

  // Do NOT expose whether the requester was blocked by the other event (M-11 privacy)
  res.json({
    success: true,
    data: {
      blocked_by_me: iBlocked,
    },
  });
}

// GET /api/v1/blocks/me  — list my blocked users
export async function myBlockedUsers(req: Request, res: Response) {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 50));
  const result = await getBlockedUsers(req.user!.userId, page, limit);
  res.json({ success: true, data: result });
}
