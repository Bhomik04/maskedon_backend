/**
 * Canonical API error codes.
 * All error responses MUST use one of these constants.
 * Codes are SCREAMING_SNAKE_CASE. Never use string literals in controllers.
 */
export const ErrorCode = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  AUTH_REQUIRED: "AUTH_REQUIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
  MISSING_TOKEN: "MISSING_TOKEN",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_EXISTS: "EMAIL_EXISTS",
  USERNAME_EXISTS: "USERNAME_EXISTS",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",

  // ── Generic resource errors ───────────────────────────────────────────────
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_STATE: "INVALID_STATE",
  INVALID_FILTER: "INVALID_FILTER",

  // ── User ──────────────────────────────────────────────────────────────────
  USER_NOT_FOUND: "USER_NOT_FOUND",

  // ── Friends ───────────────────────────────────────────────────────────────
  SELF_FRIEND: "SELF_FRIEND",
  BLOCKED: "BLOCKED",
  ALREADY_FRIENDS: "ALREADY_FRIENDS",
  ALREADY_PENDING: "ALREADY_PENDING",
  MUTUAL_PENDING: "MUTUAL_PENDING",

  // ── Blocks ────────────────────────────────────────────────────────────────
  SELF_BLOCK: "SELF_BLOCK",
  ALREADY_BLOCKED: "ALREADY_BLOCKED",

  // ── Events ───────────────────────────────────────────────────────────────
  EVENT_FULL: "EVENT_FULL",
  STORAGE_UPLOAD_FAILED: "STORAGE_UPLOAD_FAILED",

  // ── Requests ──────────────────────────────────────────────────────────────
  SELF_JOIN: "SELF_JOIN",
  ALREADY_REQUESTED: "ALREADY_REQUESTED",

  // ── Payments ──────────────────────────────────────────────────────────────
  NOT_APPROVED: "NOT_APPROVED",
  ALREADY_ATTENDING: "ALREADY_ATTENDING",
  FREE_EVENT: "FREE_EVENT",

  // ── Photos ────────────────────────────────────────────────────────────────
  NO_FILE: "NO_FILE",
  NOT_ATTENDEE: "NOT_ATTENDEE",
  ALREADY_LIKED: "ALREADY_LIKED",
  NOT_LIKED: "NOT_LIKED",

  // ── Ratings ───────────────────────────────────────────────────────────────
  NOT_ENDED: "NOT_ENDED",
  WINDOW_CLOSED: "WINDOW_CLOSED",
  NOT_PARTICIPANT: "NOT_PARTICIPANT",
  ALREADY_RATED: "ALREADY_RATED",

  // ── Reports ───────────────────────────────────────────────────────────────
  SELF_REPORT: "SELF_REPORT",
  ALREADY_REPORTED: "ALREADY_REPORTED",

  // ── Server ────────────────────────────────────────────────────────────────
  SERVER_ERROR: "SERVER_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RATE_LIMIT: "RATE_LIMIT",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
