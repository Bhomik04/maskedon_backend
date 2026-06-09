import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { screenshotUpload, submitBugReport } from "../controllers/bug-report-controller";
import { optionalAuthenticate } from "../middleware/auth";
import { bugReportLimiter } from "../middleware/rate-limiters";

const router = Router();

// POST /api/v1/bug-reports — open to all (authenticated users are tracked, others anonymous)
router.post(
  "/",
  bugReportLimiter,
  optionalAuthenticate,
  screenshotUpload.array("screenshots", 3),
  asyncHandler(submitBugReport)
);

export default router;
