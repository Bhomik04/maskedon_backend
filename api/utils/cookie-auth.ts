import { Request } from "express";

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};

  const parsed: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;

    const key = decodeURIComponent(trimmed.slice(0, idx).trim());
    const value = decodeURIComponent(trimmed.slice(idx + 1).trim());
    if (key) parsed[key] = value;
  }

  return parsed;
}

export function getCookie(req: Request, name: string): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[name] || null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveSameSite(): "lax" | "strict" | "none" {
  const raw = (process.env.AUTH_COOKIE_SAMESITE || "lax").toLowerCase();
  if (raw === "strict") return "strict";
  if (raw === "none") return "none";
  return "lax";
}

function resolveCookieDomain(): string | undefined {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  return domain && domain.length > 0 ? domain : undefined;
}

function getBaseCookieOptions(maxAgeMs: number) {
  const sameSite = resolveSameSite();
  return {
    httpOnly: true,
    secure: isProduction() || sameSite === "none",
    sameSite,
    path: "/",
    domain: resolveCookieDomain(),
    maxAge: maxAgeMs,
  } as const;
}

export function getAccessCookieOptions() {
  const maxAgeMs = 15 * 60 * 1000;
  return getBaseCookieOptions(maxAgeMs);
}

export function getRefreshCookieOptions() {
  const maxAgeMs = 90 * 24 * 60 * 60 * 1000; // 90 days — matches JWT and DB refresh token expiry
  return getBaseCookieOptions(maxAgeMs);
}

export function getAccessCookieName(): string {
  return ACCESS_COOKIE;
}

export function getRefreshCookieName(): string {
  return REFRESH_COOKIE;
}
