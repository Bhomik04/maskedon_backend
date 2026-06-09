/**
 * Centralised rate-limiter definitions for maskedOn API.
 *
 * Design principles:
 *  - Global baseline (300/15 min) lives in server.ts — catches everything.
 *  - Route-level limiters here tighten only abuse-prone write paths.
 *  - Authenticated limiters key by userId (not IP) — fair for shared IPs,
 *    prevents IP-rotation bypass.
 *  - All limiters return the standard maskedOn error envelope.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// ─── Key generators ────────────────────────────────────────────────────────────

/**
 * For authenticated routes — key by the authenticated user's ID.
 * Falls back to IP if somehow req.user is missing (shouldn't happen after
 * the authenticate middleware, but keeps the limiter defensive).
 */
function userKey(req: Request): string {
  if (req.user?.userId) return req.user.userId;
  return ipKeyGenerator(req.ip ?? "127.0.0.1");
}

// ─── Error envelope helper ────────────────────────────────────────────────────

function msg(message: string) {
  return {
    success: false,
    error: { code: "RATE_LIMIT", message },
  };
}

// ─── Limiters ─────────────────────────────────────────────────────────────────

/**
 * Event creation — 10 events per hour per user.
 * Apply AFTER authenticate so userKey resolves correctly.
 */
export const createEventLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many event creation attempts, please try again later"),
});

/**
 * Event join-request — 30 requests per 15 minutes per user.
 * Prevents a single account from spamming join requests to many events.
 */
export const joinRequestLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many join requests, please slow down"),
});

/**
 * Payment — 10 payment attempts per 15 minutes per user.
 */
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many payment attempts, please slow down"),
});

/**
 * Crowd rating — 30 submissions per hour per user.
 * Each user can rate a crowd at most once per event, so 30/hr is generous.
 */
export const crowdRatingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many rating submissions, please slow down"),
});

/**
 * Friend request / accept / reject — 40 actions per 15 minutes per user.
 */
export const friendActionLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many friend actions, please slow down"),
});

/**
 * Report submission — 10 reports per hour per user.
 * Prevents report-spam against other users.
 */
export const reportLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many reports submitted, please slow down"),
});

/**
 * Search — 60 queries per minute per user.
 * Prevents automated scraping of the user/event catalogue.
 */
export const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many search requests, please slow down"),
});

/**
 * Block / unblock actions — 30 per 15 minutes per user.
 */
export const blockActionLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many block actions, please slow down"),
});

/**
 * Password change — 5 per hour per user.
 * High-value action; brute force amplification if unprotected.
 */
export const passwordChangeLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many password change attempts, please try again later"),
});

/**
 * Account deletion — 3 attempts per day per user.
 * Irreversible action; should be strictly guarded.
 */
export const deleteAccountLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many account deletion attempts, please try again later"),
});

/**
 * Profile update (bio, display_name, etc.) — 30 per 15 minutes per user.
 */
export const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many profile update requests, please slow down"),
});

/**
 * Avatar upload — 10 per 15 minutes per user.
 */
export const avatarUploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many avatar upload attempts, please slow down"),
});

/**
 * Banner upload — 10 per 15 minutes per user.
 */
export const bannerUploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many banner upload attempts, please slow down"),
});

/**
 * Photo upload — 10 per minute per user (bandwidth-intensive).
 */
export const photoUploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many photo uploads, please slow down"),
});

/**
 * Social write actions (likes, comments) — 60 per minute per user.
 */
export const socialActionLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many actions, please slow down"),
});

export const idVerificationLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000, // 24 hours
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey,
  message: msg("Too many ID verification attempts. Please try again tomorrow."),
});

/**
 * Bug report — 5 submissions per hour, keyed by IP.
 * Anonymous endpoint; IP-based key prevents unauthenticated spam.
 */
export const bugReportLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "127.0.0.1"),
  message: msg("Too many bug reports submitted, please try again later"),
});
