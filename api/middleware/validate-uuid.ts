import { Request, Response, NextFunction } from "express";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Express router.param() callback that rejects any route param that is not a
 * valid UUID v1–v5 with a 400 INVALID_ID response before the request reaches
 * any controller or database layer.
 *
 * Usage in a route file:
 *   router.param("userId", validateUUIDParam);
 *   router.param("eventId", validateUUIDParam);
 */
export function validateUUIDParam(
  req: Request,
  res: Response,
  next: NextFunction,
  value: string
): void {
  if (!UUID_REGEX.test(value)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_ID", message: "The link you followed appears to be broken. Please go back and try again." },
    });
    return;
  }
  next();
}
