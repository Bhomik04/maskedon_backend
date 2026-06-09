import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, TokenPayload } from "../utils/auth-helpers";
import { logger } from "../lib/logger";
import { getCookie, getAccessCookieName } from "../utils/cookie-auth";

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const cookieToken = getCookie(req, getAccessCookieName());

  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    logger.warn("Unauthorized request: missing or malformed Authorization header", {
      ip: req.ip,
      path: req.path,
      reason: "AUTH_REQUIRED",
    });
    res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required" },
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    logger.warn("Unauthorized request: invalid or expired token", {
      ip: req.ip,
      path: req.path,
      reason: "INVALID_TOKEN",
    });
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
    });
  }
}

/**
 * Like `authenticate`, but does not reject unauthenticated requests.
 * Sets req.user if a valid token is present; otherwise proceeds anonymously.
 */
export function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const cookieToken = getCookie(req, getAccessCookieName());
  const bearerToken =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
  const token = cookieToken || bearerToken;

  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // Ignore invalid/expired tokens — proceed anonymously
    }
  }
  next();
}
