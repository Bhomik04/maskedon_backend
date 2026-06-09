import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { updateProfileSchema, pushTokenSchema } from "../validators/user-validators";
import { getPublicProfile, getSelfProfile, updateUserProfile, upsertPushToken, findUserById, changeUserPassword, softDeleteUser, deleteAllRefreshTokensForUser } from "../../dblayer";
import { uploadToStorage, deleteFromStorage } from "../lib/supabase";
import { comparePassword, hashPassword } from "../utils/auth-helpers";
import { logger } from "../lib/logger";
import { getAccessCookieName, getRefreshCookieName, getAccessCookieOptions, getRefreshCookieOptions } from "../utils/cookie-auth";

const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

export async function getMe(req: Request, res: Response) {
  const userId = req.user!.userId;
  const profile = await getSelfProfile(userId);

  if (!profile) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
    });
    return;
  }

  res.status(200).json({ success: true, data: { user: profile } });
}

export async function updateMe(req: Request, res: Response) {
  const userId = req.user!.userId;

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const updated = await updateUserProfile(userId, parsed.data);

  if (!updated) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
    });
    return;
  }

  res.status(200).json({ success: true, data: { user: updated } });
}
// PUT /api/v1/users/me/avatar
export async function uploadAvatar(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: { code: "NO_FILE", message: "Image file is required" },
    });
    return;
  }

  const userId = req.user!.userId;

  // Delete old avatar from storage if exists
  const currentProfile = await getPublicProfile(userId);
  if (currentProfile?.avatar_url) {
    deleteFromStorage("avatars", currentProfile.avatar_url).catch((error) => {
      logger.warn("Failed to delete old avatar from storage", {
        userId,
        avatarUrl: currentProfile.avatar_url,
        error,
      });
    });
  }

  const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
  const safeName = `${uuidv4()}${ext}`;
  const avatarUrl = await uploadToStorage("avatars", req.file.buffer, safeName, req.file.mimetype);

  const updated = await updateUserProfile(userId, { avatar_url: avatarUrl });
  if (!updated) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
    return;
  }
  res.json({ success: true, data: { user: updated } });
}

export const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB for banners
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// PUT /api/v1/users/me/banner
export async function uploadBanner(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: { code: "NO_FILE", message: "Image file is required" },
    });
    return;
  }

  const userId = req.user!.userId;

  // Delete old banner from storage if exists
  const currentProfile = await getPublicProfile(userId);
  if (currentProfile?.banner_url) {
    deleteFromStorage("banners", currentProfile.banner_url).catch((error) => {
      logger.warn("Failed to delete old banner from storage", {
        userId,
        bannerUrl: currentProfile.banner_url,
        error,
      });
    });
  }

  const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
  const safeName = `${uuidv4()}${ext}`;
  const bannerUrl = await uploadToStorage("banners", req.file.buffer, safeName, req.file.mimetype);

  const updated = await updateUserProfile(userId, { banner_url: bannerUrl });
  if (!updated) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
    return;
  }
  res.json({ success: true, data: { user: updated } });
}

// POST /api/v1/users/me/push-token
export async function registerPushToken(req: Request, res: Response) {
  const parsed = pushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  await upsertPushToken(req.user!.userId, parsed.data.token, parsed.data.platform);
  res.status(200).json({ success: true, data: { message: "Push token registered" } });
}

export async function getUserProfile(req: Request, res: Response) {
  const userId = req.params.userId as string;

  if (!userId) {
    res.status(400).json({
      success: false,
      error: { code: "MISSING_PARAM", message: "User ID is required" },
    });
    return;
  }

  // Validate UUID format to prevent unnecessary DB queries (L-3)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(userId)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PARAM", message: "Invalid user ID format" },
    });
    return;
  }

  const profile = await getPublicProfile(userId);

  if (!profile) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
    });
    return;
  }

  res.status(200).json({ success: true, data: { user: profile } });
}

export async function changePassword(req: Request, res: Response) {
  const userId = req.user!.userId;
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "currentPassword and newPassword are required" } });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ success: false, error: { code: "INVALID_PASSWORD", message: "New password must be at least 8 characters" } });
    return;
  }
  if (newPassword.length > 128) {
    res.status(400).json({ success: false, error: { code: "INVALID_PASSWORD", message: "New password must not exceed 128 characters" } });
    return;
  }

  const user = await findUserById(userId);
  if (!user) {
    res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
    return;
  }

  const match = await comparePassword(currentPassword, user.password_hash);
  if (!match) {
    res.status(401).json({ success: false, error: { code: "WRONG_PASSWORD", message: "Current password is incorrect" } });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await changeUserPassword(userId, newHash);
  res.status(200).json({ success: true, data: { message: "Password changed successfully" } });
}

export async function deleteAccount(req: Request, res: Response) {
  const userId = req.user!.userId;
  const { password } = req.body as { password?: string };

  if (!password) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "password is required to confirm deletion" } });
    return;
  }

  const user = await findUserById(userId);
  if (!user) {
    res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
    return;
  }

  const match = await comparePassword(password, user.password_hash);
  if (!match) {
    res.status(401).json({ success: false, error: { code: "WRONG_PASSWORD", message: "Password is incorrect" } });
    return;
  }

  await softDeleteUser(userId);
  await deleteAllRefreshTokensForUser(userId);
  res.clearCookie(getAccessCookieName(), { ...getAccessCookieOptions(), maxAge: 0 });
  res.clearCookie(getRefreshCookieName(), { ...getRefreshCookieOptions(), maxAge: 0 });
  res.status(200).json({ success: true, data: { message: "Account deleted successfully" } });
}
