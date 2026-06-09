import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";
import { universalSearch } from "../controllers/search-controller";
import { searchLimiter } from "../middleware/rate-limiters";

const router = Router();

// Rate limited to prevent catalogue scraping
router.get("/", authenticate, searchLimiter, asyncHandler(universalSearch));

export default router;
