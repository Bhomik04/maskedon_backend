import crypto from "crypto";
import { Request, Response } from "express";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resendVerificationSchema,
  verifyEmailSchema,
  resetPasswordSchema,
} from "../validators/auth-validators";
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
} from "../utils/auth-helpers";
import {
  createUser,
  findUserByEmail,
  findUserByUsername,
  findUserById,
  storeRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
  deleteAllRefreshTokensForUser,
  createEmailVerificationToken,
  findEmailVerificationToken,
  deleteEmailVerificationTokensByUser,
  markUserEmailVerified,
  createPasswordResetToken,
  findPasswordResetToken,
  deletePasswordResetTokensByUser,
  changeUserPassword,
} from "../../dblayer";
import {
  getCookie,
  getAccessCookieName,
  getRefreshCookieName,
  getAccessCookieOptions,
  getRefreshCookieOptions,
} from "../utils/cookie-auth";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../lib/email";
import { logger } from "../lib/logger";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;    // 1 hour

function stripPassword(user: any) {
  const { password_hash, ...publicUser } = user;
  return publicUser;
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(getAccessCookieName(), accessToken, getAccessCookieOptions());
  res.cookie(getRefreshCookieName(), refreshToken, getRefreshCookieOptions());
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(getAccessCookieName(), { ...getAccessCookieOptions(), maxAge: 0 });
  res.clearCookie(getRefreshCookieName(), { ...getRefreshCookieOptions(), maxAge: 0 });
}

function createAuthPayload(user: any) {
  const tokenPayload = { userId: user.id, username: user.username };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  return {
    accessToken,
    refreshToken,
    responseData: {
      user: stripPassword(user),
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
      },
    },
  };
}

/** Generates a cryptographically-secure random token. Returns the raw hex
 *  string (sent in email links) and its SHA-256 hash (stored in DB). */
function generateSecureToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  return { raw, hash };
}

function getEmailBaseUrl(): string {
  const configured = process.env.FRONTEND_URL || process.env.FRONTEND_URLS || "";
  const first = configured
    .split(",")
    .map((v) => v.trim())
    .find((v) => v.length > 0);

  if (!first) {
    throw new Error("FRONTEND_URL environment variable is not set.");
  }
  return first.replace(/\/+$/, "");
}

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { email, username, password, display_name, date_of_birth } = parsed.data;

  const existingByEmail = await findUserByEmail(email);

  // Case 1: Email already verified → conflict
  if (existingByEmail?.is_email_verified) {
    res.status(409).json({
      success: false,
      error: { code: "EMAIL_EXISTS", message: "An account with this email already exists. Please log in." },
    });
    return;
  }

  // Case 2: Email in DB but not yet verified → resend verification
  if (existingByEmail && !existingByEmail.is_email_verified) {
    try {
      await deleteEmailVerificationTokensByUser(existingByEmail.id);
      const { raw, hash } = generateSecureToken();
      const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
      await createEmailVerificationToken(existingByEmail.id, hash, expiresAt);
      const verifyUrl = `${getEmailBaseUrl()}/auth/verify-email?token=${raw}`;
      await sendVerificationEmail(email, existingByEmail.display_name, verifyUrl);
    } catch {
      // Don't reveal which path was taken
    }
    clearAuthCookies(res);
    res.status(200).json({
      success: true,
      data: {
        requires_email_verification: true,
        message: "A verification email has already been sent to this address. Please check your inbox (and spam folder).",
      },
    });
    return;
  }

  // Case 3: Fresh registration
  const existingByUsername = await findUserByUsername(username);
  if (existingByUsername) {
    res.status(409).json({
      success: false,
      error: { code: "USERNAME_EXISTS", message: "This username is already taken" },
    });
    return;
  }

  const passwordHash = await hashPassword(password);

  let newUser;
  try {
    newUser = await createUser(email, username, passwordHash, display_name, date_of_birth);
  } catch (err: any) {
    if (err?.code === "23505") {
      const detail: string = err.detail || err.constraint || "";
      if (detail.includes("username")) {
        res.status(409).json({ success: false, error: { code: "USERNAME_EXISTS", message: "This username is already taken." } });
      } else {
        res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "An account with this email already exists." } });
      }
    } else {
      res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong while creating your account. Please try again." } });
    }
    return;
  }

  try {
    const { raw, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
    await createEmailVerificationToken(newUser.id, hash, expiresAt);
    const verifyUrl = `${getEmailBaseUrl()}/auth/verify-email?token=${raw}`;
    await sendVerificationEmail(email, display_name, verifyUrl);
  } catch (err) {
    logger.error("[register] Failed to send verification email", { message: (err as Error)?.message });
    // User was created — they can use resend-verification to retry
  }

  clearAuthCookies(res);
  res.status(201).json({
    success: true,
    data: {
      requires_email_verification: true,
      message: "Account created. Please verify your email before signing in.",
    },
  });
}

// ── Verify Email ──────────────────────────────────────────────────────────────

export async function verifyEmail(req: Request, res: Response) {
  const parsed = verifyEmailSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid or missing verification token." },
    });
    return;
  }

  const tokenHash = hashToken(parsed.data.token);
  const record = await findEmailVerificationToken(tokenHash);

  if (!record) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "This verification link is invalid or has already been used." },
    });
    return;
  }

  if (record.expires_at < new Date()) {
    await deleteEmailVerificationTokensByUser(record.user_id).catch(() => {});
    res.status(400).json({
      success: false,
      error: { code: "TOKEN_EXPIRED", message: "This verification link has expired. Please request a new one." },
    });
    return;
  }

  await markUserEmailVerified(record.user_id);
  await deleteEmailVerificationTokensByUser(record.user_id);

  res.status(200).json({
    success: true,
    data: { message: "Email verified successfully. You can now sign in." },
  });
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });
    return;
  }

  const passwordMatch = await comparePassword(password, user.password_hash);
  if (!passwordMatch) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });
    return;
  }

  if (!user.is_email_verified) {
    res.status(403).json({
      success: false,
      error: { code: "EMAIL_NOT_VERIFIED", message: "Please verify your email before signing in." },
    });
    return;
  }

  const { accessToken, refreshToken, responseData } = createAuthPayload(user);
  await storeRefreshToken(user.id, hashToken(refreshToken), getRefreshTokenExpiry());
  setAuthCookies(res, accessToken, refreshToken);

  res.status(200).json({ success: true, data: responseData });
}

export async function resendVerification(req: Request, res: Response) {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { email } = parsed.data;
  const okResponse = {
    success: true,
    data: { message: "If this email is registered and unverified, a verification link has been sent." },
  };

  const user = await findUserByEmail(email);
  if (!user || user.is_email_verified) {
    res.status(200).json(okResponse);
    return;
  }

  try {
    await deleteEmailVerificationTokensByUser(user.id);
    const { raw, hash } = generateSecureToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);
    await createEmailVerificationToken(user.id, hash, expiresAt);
    const verifyUrl = `${getEmailBaseUrl()}/auth/verify-email?token=${raw}`;
    await sendVerificationEmail(email, user.display_name, verifyUrl);
  } catch (err) {
    logger.error("[resendVerification] Failed to send email", { message: (err as Error)?.message });
  }

  res.status(200).json(okResponse);
}

export async function forgotPassword(req: Request, res: Response) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { email } = parsed.data;
  const okResponse = {
    success: true,
    data: { message: "If this email exists, a password reset link has been sent." },
  };

  let user;
  try {
    user = await findUserByEmail(email);
  } catch (err) {
    logger.error("[forgotPassword] DB error looking up user", { message: (err as Error)?.message });
    res.status(200).json(okResponse);
    return;
  }

  if (user) {
    try {
      await deletePasswordResetTokensByUser(user.id);
      const { raw, hash } = generateSecureToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
      await createPasswordResetToken(user.id, hash, expiresAt);
      const resetUrl = `${getEmailBaseUrl()}/auth/reset-password?token=${raw}`;
      await sendPasswordResetEmail(email, user.display_name, resetUrl);
    } catch (err) {
      logger.error("[forgotPassword] Failed to send reset email", { message: (err as Error)?.message });
    }
  }

  res.status(200).json(okResponse);
}

// ── Reset Password ────────────────────────────────────────────────────────────

export async function resetPassword(req: Request, res: Response) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  let record;
  try {
    record = await findPasswordResetToken(tokenHash);
  } catch (err) {
    logger.error("[resetPassword] DB error looking up token", { message: (err as Error)?.message });
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on our end. Please try again." },
    });
    return;
  }

  if (!record) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "This password reset link is invalid or has already been used." },
    });
    return;
  }

  if (record.expires_at < new Date()) {
    await deletePasswordResetTokensByUser(record.user_id).catch(() => {});
    res.status(400).json({
      success: false,
      error: { code: "TOKEN_EXPIRED", message: "This reset link has expired. Please request a new one." },
    });
    return;
  }

  try {
    const newPasswordHash = await hashPassword(password);
    await changeUserPassword(record.user_id, newPasswordHash);
    await deletePasswordResetTokensByUser(record.user_id);
    await deleteAllRefreshTokensForUser(record.user_id);
  } catch (err) {
    logger.error("[resetPassword] DB error updating password", { message: (err as Error)?.message });
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on our end. Please try again." },
    });
    return;
  }

  clearAuthCookies(res);
  res.status(200).json({
    success: true,
    data: { message: "Password updated successfully. Please sign in with your new password." },
  });
}

export async function refresh(req: Request, res: Response) {
  const refreshTokenFromBody =
    typeof req.body?.refresh_token === "string" ? req.body.refresh_token : null;
  const refreshTokenFromCookie = getCookie(req, getRefreshCookieName());
  const refresh_token = refreshTokenFromCookie || refreshTokenFromBody;

  if (!refresh_token || typeof refresh_token !== "string") {
    res.status(400).json({
      success: false,
      error: { code: "MISSING_TOKEN", message: "Refresh token is required" },
    });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(refresh_token);
  } catch {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Invalid or expired refresh token" },
    });
    return;
  }

  const tokenHash = hashToken(refresh_token);
  const stored = await findRefreshToken(tokenHash);
  if (!stored || stored.expires_at < new Date()) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Refresh token not found or expired" },
    });
    return;
  }

  await deleteRefreshToken(tokenHash);

  const user = await findUserById(payload.userId);
  if (!user) {
    clearAuthCookies(res);
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "User no longer exists" },
    });
    return;
  }

  const { accessToken: newAccessToken, refreshToken: newRefreshToken, responseData } = createAuthPayload(user);

  await storeRefreshToken(payload.userId, hashToken(newRefreshToken), getRefreshTokenExpiry());
  setAuthCookies(res, newAccessToken, newRefreshToken);

  res.status(200).json({
    success: true,
    data: {
      message: "Token refreshed",
      ...responseData,
    },
  });
}

export async function logout(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
    return;
  }

  await deleteAllRefreshTokensForUser(userId);
  clearAuthCookies(res);

  res.status(200).json({
    success: true,
    data: { message: "Logged out successfully" },
  });
}
