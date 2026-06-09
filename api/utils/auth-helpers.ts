import jwt, { SignOptions } from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in environment variables");
}
// Narrowed to string after the guard above — safe to assert
const ACCESS_SECRET_STR: string = ACCESS_SECRET;
const REFRESH_SECRET_STR: string = REFRESH_SECRET;
const ACCESS_EXPIRES_IN = 900; // 15 minutes in seconds
const REFRESH_EXPIRES_IN = 90 * 24 * 60 * 60; // 90 days in seconds
const BCRYPT_ROUNDS = 12;

export interface TokenPayload {
  userId: string;
  username: string;
}

export function generateAccessToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: ACCESS_EXPIRES_IN };
  return jwt.sign({ ...payload }, ACCESS_SECRET_STR, options);
}

export function generateRefreshToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: REFRESH_EXPIRES_IN };
  return jwt.sign({ ...payload }, REFRESH_SECRET_STR, options);
}

function assertTokenPayload(payload: unknown): asserts payload is TokenPayload {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).userId !== "string" ||
    typeof (payload as Record<string, unknown>).username !== "string"
  ) {
    throw new Error("Invalid token payload shape");
  }
}

export function verifyAccessToken(token: string): TokenPayload {
  const payload = jwt.verify(token, ACCESS_SECRET_STR, { algorithms: ["HS256"] });
  assertTokenPayload(payload);
  return payload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  const payload = jwt.verify(token, REFRESH_SECRET_STR, { algorithms: ["HS256"] });
  assertTokenPayload(payload);
  return payload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Returns the expiration date for refresh tokens (90 days) */
export function getRefreshTokenExpiry(): Date {
  return new Date(Date.now() + REFRESH_EXPIRES_IN * 1000);
}
