import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { asyncHandler } from "../utils/async-handler";
import { myAchievements, catalog, userAchievements } from "../controllers/achievement-controller";

const router = Router();

router.use(authenticate);
router.param("userId", validateUUIDParam);

// GET /api/v1/achievements/catalog
router.get("/catalog", asyncHandler(catalog));

// GET /api/v1/achievements/me
router.get("/me", asyncHandler(myAchievements));

// GET /api/v1/achievements/user/:userId
router.get("/user/:userId", asyncHandler(userAchievements));

export default router;
