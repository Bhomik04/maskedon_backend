import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";
import { submitReport } from "../controllers/report-controller";
import { reportLimiter } from "../middleware/rate-limiters";

const router = Router();

router.use(authenticate);

// POST /api/v1/reports – submit a report (rate limited to prevent spam reports)
router.post("/", reportLimiter, asyncHandler(submitReport));

export default router;
