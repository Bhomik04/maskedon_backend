import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

/**
 * Middleware that validates the X-Admin-Secret header.
 * Only for use on admin routes — never mix with public routes.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_SECRET) {
    logger.error("ADMIN_SECRET environment variable is not set — admin routes are locked");
    res.status(503).json({
      success: false,
      error: { code: "ADMIN_DISABLED", message: "Admin panel is not configured on this server" },
    });
    return;
  }

  const provided = req.headers["x-admin-secret"];

  // Constant-time comparison to prevent timing attacks
  const isValid = typeof provided === "string" && (() => {
    try {
      const secretBuf = Buffer.from(ADMIN_SECRET!);
      const providedBuf = Buffer.from(provided);
      if (providedBuf.length !== secretBuf.length) return false;
      return crypto.timingSafeEqual(secretBuf, providedBuf);
    } catch {
      return false;
    }
  })();

  if (!isValid) {
    logger.warn("Rejected admin request with invalid secret", {
      ip: req.ip,
      path: req.path,
    });
    res.status(401).json({
      success: false,
      error: { code: "ADMIN_AUTH_REQUIRED", message: "Invalid or missing admin secret" },
    });
    return;
  }

  next();
}
