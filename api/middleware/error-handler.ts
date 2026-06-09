import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// Map PostgreSQL error codes to user-friendly messages
function getFriendlyDbError(err: any): { status: number; code: string; message: string } | null {
  if (!err || typeof err.code !== "string") return null;

  switch (err.code) {
    case "23505": {
      // Unique constraint violation — figure out which field from the constraint name
      const detail: string = err.detail || err.constraint || "";
      if (detail.includes("email")) {
        return { status: 409, code: "EMAIL_EXISTS", message: "An account with this email already exists." };
      }
      if (detail.includes("username")) {
        return { status: 409, code: "USERNAME_EXISTS", message: "This username is already taken. Please choose a different one." };
      }
      return { status: 409, code: "ALREADY_EXISTS", message: "This entry already exists. Please use different details." };
    }
    case "23503":
      return { status: 400, code: "INVALID_REFERENCE", message: "The item you're referring to no longer exists." };
    case "23502":
      return { status: 400, code: "MISSING_FIELD", message: "Some required information is missing. Please fill in all fields." };
    case "22001":
      return { status: 400, code: "VALUE_TOO_LONG", message: "One of the values you entered is too long. Please shorten it and try again." };
    case "08006":
    case "08001":
    case "08004":
      return { status: 503, code: "DB_UNAVAILABLE", message: "We're having trouble connecting to our servers. Please try again in a moment." };
    default:
      return null;
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error("Unhandled request error", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    origin: req.headers.origin,
    userAgent: req.headers["user-agent"],
    error: err,
  });

  // Check for known database errors first — always return friendly message
  const dbError = getFriendlyDbError(err);
  if (dbError) {
    res.status(dbError.status).json({
      success: false,
      error: {
        code: dbError.code,
        message: dbError.message,
        request_id: req.requestId,
      },
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong on our end. Please try again.",
      request_id: req.requestId,
    },
  });
}
