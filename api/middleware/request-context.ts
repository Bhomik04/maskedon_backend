import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const LOG_HTTP_REQUESTS = (process.env.LOG_HTTP_REQUESTS || "false") === "true";

function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

const SAFE_REQUEST_ID_RE = /^[a-zA-Z0-9\-_]{8,128}$/;

export function attachRequestContext(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = req.headers["x-request-id"];
  // Only accept client-supplied IDs that match a safe alphanumeric pattern.
  // Reject anything else (e.g. CRLF injection, arbitrary strings) and generate a fresh ID.
  const requestId =
    typeof incomingRequestId === "string" && SAFE_REQUEST_ID_RE.test(incomingRequestId)
      ? incomingRequestId
      : createRequestId();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  if (!LOG_HTTP_REQUESTS) {
    next();
    return;
  }

  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    logger.info("HTTP request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
