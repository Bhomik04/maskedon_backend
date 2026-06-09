import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { createServer } from "http";

// Load env vars before anything else
dotenv.config();

import authRoutes from "./routes/auth-routes";
import userRoutes from "./routes/user-routes";
import eventRoutes from "./routes/event-routes";
import photoRoutes from "./routes/photo-routes";
import notificationRoutes from "./routes/notification-routes";
import friendRoutes from "./routes/friend-routes";
import searchRoutes from "./routes/search-routes";
import feedRoutes from "./routes/feed-routes";
import blockRoutes from "./routes/block-routes";
import reportRoutes from "./routes/report-routes";
import achievementRoutes from "./routes/achievement-routes";
import bugReportRoutes from "./routes/bug-report-routes";
import adminRoutes from "./routes/admin-routes";
import messagesRoutes from "./routes/messages-routes";
import verificationRoutes from "./routes/verification-routes";
import { asyncHandler } from "./utils/async-handler";
import * as paymentCtrl from "./controllers/payment-controller";
import { errorHandler } from "./middleware/error-handler";
import { purgeResponseCache } from "./middleware/cache-response";
import { testConnection, deleteExpiredRefreshTokens } from "../dblayer";
import { runAllMigrations } from "../dblayer/run-all-migrations";
import { initWebSocket } from "./lib/websocket";
import { getConfiguredOrigins, isOriginAllowed } from "./lib/allowed-origins";
import { logger } from "./lib/logger";
import { attachRequestContext } from "./middleware/request-context";
import { runFinancialWorkers } from "./lib/financial-workers";

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);
const API_RATE_LIMIT_MAX = parseInt(process.env.API_RATE_LIMIT_MAX || "300", 10);

// Required on Render/other proxies so IP-based middleware behaves correctly.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Security middleware
app.use(helmet({
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts:
    process.env.NODE_ENV === "production" && process.env.DISABLE_HSTS !== "true"
      ? { maxAge: 15552000, includeSubDomains: true, preload: true }
      : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : ["https:"]),
      ],
      connectSrc: [
        "'self'",
        ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : ["https:"]),
        "wss:",
      ],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.use(attachRequestContext);

// Health check — BEFORE CORS so Render's internal probe (no Origin header) is never blocked.
// We add minimal CORS headers manually so mobile WebViews (Capacitor) can also reach this.
app.get("/api/v1/health", (req, res) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.json({ success: true, data: { status: "ok", timestamp: new Date().toISOString() } });
});

app.use(cors({
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked: origin '${origin ?? "(none)"}' is not allowed`));
  },
  credentials: true,
  // Explicitly list allowed headers so preflight works correctly on Android WebView
  // (some versions do not properly reflect Access-Control-Request-Headers).
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Admin-Secret"],
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
}));

// Baseline API limiter for abuse protection (auth has a stricter limiter below).
app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Too many requests, please try again later" },
  },
}));

// Coarse auth-route guard — per-endpoint limiters in auth-routes.ts add finer control.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Too many requests, please try again later" },
  },
});

// Cashfree webhook — raw JSON body needed for HMAC signature verification
// Must be registered before the global express.json() middleware
app.post(
  "/api/v1/webhooks/cashfree",
  express.raw({ type: "application/json" }),
  asyncHandler(paymentCtrl.cashfreeWebhook)
);

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Automatically purge server-side response cache after any successful mutation.
// Mutations are infrequent relative to reads, so a full purge on every write is safe.
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        purgeResponseCache();
      }
    });
  }
  next();
});

// Routes
app.use("/api/v1/auth", authLimiter, authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/events", eventRoutes);
app.use("/api/v1/photos", photoRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/friends", friendRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/feed", feedRoutes);
app.use("/api/v1/blocks", blockRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/achievements", achievementRoutes);
app.use("/api/v1/messages", messagesRoutes);
app.use("/api/v1/bug-reports", bugReportRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/verification", verificationRoutes);

// App version check — public, no auth required (used by mobile force-update gate)
app.get("/api/v1/app/version", (_req, res) => {
  res.json({
    success: true,
    data: {
      min_version:    process.env.APP_MIN_VERSION    ?? "1.0",
      latest_version: process.env.APP_LATEST_VERSION ?? "1.0",
      download_url:   process.env.APP_DOWNLOAD_URL   ?? "",
    },
  });
});

// 404 handler for unmatched routes (L-11)
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
});

// Error handling (must be last)
app.use(errorHandler);

// Create HTTP server and attach Express + WebSocket
const httpServer = createServer(app);
export const io = initWebSocket(httpServer);

// Start server
async function start() {
  try {
    await runAllMigrations({ exitOnFinish: false });
  } catch (err) {
    logger.warn("Auto-migration failed during startup.", err);
  }

  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn("Database not available - server starting without DB connectivity.");
    logger.warn("Make sure PostgreSQL (or Supabase DATABASE_URL) is configured.");
  }

  // Clean up expired refresh tokens on startup, then every 24 hours
  deleteExpiredRefreshTokens().catch((err: unknown) => logger.error("Token cleanup failed:", err));
  setInterval(
    () => deleteExpiredRefreshTokens().catch((err: unknown) => logger.error("Token cleanup failed:", err)),
    24 * 60 * 60 * 1000
  );

  runFinancialWorkers().catch((err: unknown) => logger.error("Initial financial worker pass failed:", err));
  setInterval(
    () => runFinancialWorkers().catch((err: unknown) => logger.error("Financial worker pass failed:", err)),
    60 * 1000
  );

  httpServer.listen(PORT, () => {
    logger.info(`maskedOn API server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
    if (process.env.NODE_ENV === "production") {
      const origins = getConfiguredOrigins();
      logger.info(`Allowed frontend origins: ${origins.length > 0 ? origins.join(", ") : "(none configured)"}`);
      if (process.env.FRONTEND_ORIGIN_PATTERNS) {
        logger.info(`Allowed origin wildcard patterns: ${process.env.FRONTEND_ORIGIN_PATTERNS}`);
      }
    }
  });
}

start();

export default app;
