import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";
import { getFeed, getDiscover } from "../controllers/feed-controller";

const router = Router();

// GET /api/v1/feed — auth required
router.get("/", authenticate, asyncHandler(getFeed));

// GET /api/v1/feed/discover — personalized discovery feed
router.get("/discover", authenticate, asyncHandler(getDiscover));

export default router;
