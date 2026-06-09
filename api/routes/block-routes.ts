import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { asyncHandler } from "../utils/async-handler";
import {
  blockUser,
  unblockUser,
  blockStatus,
  myBlockedUsers,
} from "../controllers/block-controller";
import { blockActionLimiter } from "../middleware/rate-limiters";

const router = Router();

router.use(authenticate);
router.param("userId", validateUUIDParam);

// My blocked users list
router.get("/me", asyncHandler(myBlockedUsers));

// Actions on specific user (write operations — rate limited)
router.post("/:userId", blockActionLimiter, asyncHandler(blockUser));
router.delete("/:userId", asyncHandler(unblockUser));
router.get("/:userId/status", asyncHandler(blockStatus));

export default router;
