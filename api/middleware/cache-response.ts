/**
 * cache-response.ts — Lightweight in-memory response cache for expensive GET endpoints.
 *
 * Two modes:
 * - `sharedCache(ttlMs)` — Same cache key for all users (URL only). Use for
 *   non-personalized endpoints like event discover list.
 * - `privateCache(ttlMs)` — Cache key includes the authenticated userId. Use for
 *   per-user endpoints like host analytics.
 *
 * Mutation-aware: call `purgeResponseCache(pattern)` after writes to invalidate
 * entries whose URL matches the pattern.
 */

import type { Request, Response, NextFunction } from "express";

interface CachedResponse {
  body: unknown;
  statusCode: number;
  timestamp: number;
}

const store = new Map<string, CachedResponse>();
const MAX_ENTRIES = 500;
const PRUNE_COUNT = 100;

// ── Helpers ──────────────────────────────────────────────────────────

function buildKey(prefix: string, url: string): string {
  return `${prefix}::${url}`;
}

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const sorted = [...store.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (let i = 0; i < PRUNE_COUNT && i < sorted.length; i++) {
    store.delete(sorted[i][0]);
  }
}

function wrapJson(
  res: Response,
  cacheKey: string,
  ttlMs: number,
): void {
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      store.set(cacheKey, { body, statusCode: res.statusCode, timestamp: Date.now() });
      evictIfNeeded();
    }
    res.setHeader("X-Cache", "MISS");
    return originalJson(body);
  } as Response["json"];
}

// ── Middleware Factories ─────────────────────────────────────────────

/**
 * Cache the response with a shared key (URL only, no userId).
 * Safe ONLY for endpoints whose response does NOT depend on the requester.
 */
export function sharedCache(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET") { next(); return; }

    const key = buildKey("shared", req.originalUrl);
    const hit = store.get(key);

    if (hit && Date.now() - hit.timestamp < ttlMs) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "private, no-store");
      res.status(hit.statusCode).json(hit.body);
      return;
    }

    wrapJson(res, key, ttlMs);
    next();
  };
}

/**
 * Cache the response per authenticated user (URL + userId).
 * Safe for personalized endpoints.
 */
export function privateCache(ttlMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET") { next(); return; }

    const userId = (req as any).user?.userId as string | undefined;
    if (!userId) { next(); return; } // Not authenticated — skip cache

    const key = buildKey(`user:${userId}`, req.originalUrl);
    const hit = store.get(key);

    if (hit && Date.now() - hit.timestamp < ttlMs) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "private, no-store");
      res.status(hit.statusCode).json(hit.body);
      return;
    }

    wrapJson(res, key, ttlMs);
    next();
  };
}

/**
 * Purge all cached entries whose URL portion matches the given pattern.
 * Call after mutations that affect cached data.
 */
export function purgeResponseCache(pattern?: RegExp): void {
  if (!pattern) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    // Key format: "prefix::url"
    const url = key.split("::").slice(1).join("::");
    if (pattern.test(url)) store.delete(key);
  }
}
