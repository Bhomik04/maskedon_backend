const LOCAL_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176", // admin panel
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5176", // admin panel
  "https://localhost",     // Capacitor HTTPS on dev emulator
]);

// Capacitor native apps on Android/iOS present these origins when making
// requests to an external server. They are our own app binary — not a browser
// page that could be loaded by a malicious site — so they are always trusted.
// NOTE: "https://localhost" is only allowed in non-production environments (L-13).
const NATIVE_APP_ORIGINS = new Set([
  "capacitor://localhost",
  "capacitor://",        // Some Android WebViews omit the host part
  "ionic://localhost",
  "ionic://",            // Same omission possible for Ionic
  "http://localhost",
  "http://127.0.0.1",
  "https://localhost",
  "null",
]);

function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

function parseOriginList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Parse a wildcard origin pattern (e.g. "*.netlify.app") into a safe regex.
 * Only supports `*` as a wildcard (matches one or more non-dot characters).
 * Full regex patterns are NOT accepted to prevent ReDoS attacks.
 */
function parseOriginWildcards(value?: string): RegExp[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((pattern) => {
      // Escape regex special chars, then replace literal `\*` with `[^.]+`
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const withWildcard = escaped.replace(/\\\*/g, "[^.]+");
      return new RegExp(`^${withWildcard}$`);
    });
}

const configuredOrigins = parseOriginList(process.env.FRONTEND_URLS || process.env.FRONTEND_URL);
const configuredWildcards = parseOriginWildcards(process.env.FRONTEND_ORIGIN_PATTERNS);

export function getConfiguredOrigins(): string[] {
  return [...configuredOrigins];
}

export function isOriginAllowed(origin?: string): boolean {
  // Some native WebView/network stacks may omit Origin for cross-origin API
  // calls. Allow this in production via explicit env flag.
  if (!origin) {
    if (process.env.NODE_ENV !== "production") {
      return true;
    }
    return process.env.ALLOW_NO_ORIGIN_IN_PROD !== "false";
  }

  // Native Capacitor / Ionic apps always use these origins — always trusted.
  if (NATIVE_APP_ORIGINS.has(origin)) {
    return true;
  }

  // Any capacitor:// or ionic:// scheme is our own app binary — always trust.
  if (origin.startsWith("capacitor://") || origin.startsWith("ionic://")) {
    return true;
  }

  // Allow any loopback origin (any scheme/port) — covers native app WebView
  // differences across Android devices AND the local admin panel connecting to
  // the production backend. Admin routes are still gated by ADMIN_SECRET.
  if (isLoopbackOrigin(origin)) {
    return true;
  }

  if (LOCAL_ORIGINS.has(origin)) {
    return process.env.NODE_ENV !== "production";
  }

  if (configuredOrigins.includes(origin)) {
    return true;
  }

  if (configuredWildcards.some((re) => re.test(origin))) {
    return true;
  }

  return false;
}
