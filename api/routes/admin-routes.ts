import { Router } from "express";
import { adminAuth } from "../middleware/admin-auth";
import { asyncHandler } from "../utils/async-handler";
import * as admin from "../controllers/admin-controller";
import rateLimit from "express-rate-limit";

const router = Router();

// Strict rate limiter — admin panel is local-only; 300 req/15min per IP is generous
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Too many admin requests" },
  },
});

router.use(adminLimiter);
router.use(adminAuth);

// Dashboard
router.get("/stats", asyncHandler(admin.getStats));

// Users
router.get("/users", asyncHandler(admin.listUsers));
router.get("/users/:id", asyncHandler(admin.getUser));
router.patch("/users/:id", asyncHandler(admin.updateUser));
router.delete("/users/:id", asyncHandler(admin.deleteUser));

// Events
router.get("/events", asyncHandler(admin.listEvents));
router.patch("/events/:id", asyncHandler(admin.updateEvent));
router.delete("/events/:id", asyncHandler(admin.deleteEvent));

// Photos
router.get("/photos", asyncHandler(admin.listPhotos));
router.delete("/photos/:id", asyncHandler(admin.deletePhoto));

// Reports
router.get("/reports", asyncHandler(admin.listReports));
router.patch("/reports/:id", asyncHandler(admin.updateReport));

// Bug Reports
router.get("/bug-reports", asyncHandler(admin.listBugReports));
router.patch("/bug-reports/:id", asyncHandler(admin.updateBugReport));

// Payments
router.get("/payments", asyncHandler(admin.listPayments));
router.post("/payments/:id/refund", asyncHandler(admin.refundPaymentDirectly));

// Financial operations
router.get("/refund-jobs", asyncHandler(admin.listRefundJobs));
router.post("/refund-jobs/:id/retry", asyncHandler(admin.retryRefundJobById));
router.get("/host-payouts", asyncHandler(admin.listHostPayouts));
router.post("/host-payouts/:id/release", asyncHandler(admin.releaseHostPayout));
router.post("/host-payouts/force", asyncHandler(admin.forceHostPayout));
router.get("/refund-requests", asyncHandler(admin.listRefundRequests));
router.post("/refund-requests/:id/review", asyncHandler(admin.reviewRefundRequest));
router.get("/platform-settings", asyncHandler(admin.getPlatformSettings));
router.post("/platform-settings", asyncHandler(admin.updatePlatformSettings));
router.get("/host-overrides", asyncHandler(admin.listHostOverrides));
router.post("/users/:hostId/commission-override", asyncHandler(admin.updateHostOverrideRate));

// Verifications (KYC queue)
router.get("/verifications", asyncHandler(admin.listVerifications));
router.patch("/verifications/:userId", asyncHandler(admin.reviewVerification));

// Broadcast push notification
router.post("/notifications/broadcast", asyncHandler(admin.broadcastNotification));

export default router;
