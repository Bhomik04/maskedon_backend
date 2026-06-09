import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";
import * as verificationCtrl from "../controllers/verification-controller";
import rateLimit from "express-rate-limit";

const router = Router();

// Strict rate limit — KYC submissions are rare and sensitive
const kycLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMIT", message: "Too many verification attempts, please try again later" },
  },
});

// GET  /api/v1/verification/host — get own verification status
router.get("/host", authenticate, asyncHandler(verificationCtrl.getStatus));

// POST /api/v1/verification/host — first-time submission
router.post(
  "/host",
  authenticate,
  kycLimiter,
  verificationCtrl.upload.fields([
    { name: "pan_image", maxCount: 1 },
    { name: "aadhaar_image", maxCount: 1 },
  ]),
  asyncHandler(verificationCtrl.submit)
);

// PUT  /api/v1/verification/host — resubmit / update details
router.put(
  "/host",
  authenticate,
  kycLimiter,
  verificationCtrl.upload.fields([
    { name: "pan_image", maxCount: 1 },
    { name: "aadhaar_image", maxCount: 1 },
  ]),
  asyncHandler(verificationCtrl.update)
);

export default router;
