import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { asyncHandler } from "../utils/async-handler";
import {
  sendRequest,
  accept,
  reject,
  unfriend,
  myFriends,
  myPendingRequests,
  mySentRequests,
  friendSuggestions,
  myFriendCount,
  listUserFriends,
  friendshipStatus,
  mutual,
} from "../controllers/friend-controller";
import { friendActionLimiter } from "../middleware/rate-limiters";

const router = Router();

router.use(authenticate);
router.param("userId", validateUUIDParam);

// My friends
router.get("/me", asyncHandler(myFriends));
router.get("/me/pending", asyncHandler(myPendingRequests));
router.get("/me/sent", asyncHandler(mySentRequests));
router.get("/me/suggestions", asyncHandler(friendSuggestions));
router.get("/me/count", asyncHandler(myFriendCount));

// Actions on specific user (write operations — rate limited)
router.post("/:userId", friendActionLimiter, asyncHandler(sendRequest));
router.patch("/:userId/accept", friendActionLimiter, asyncHandler(accept));
router.patch("/:userId/reject", friendActionLimiter, asyncHandler(reject));
router.delete("/:userId", asyncHandler(unfriend));

// Public reads
router.get("/:userId/list", asyncHandler(listUserFriends));
router.get("/:userId/status", asyncHandler(friendshipStatus));
router.get("/:userId/mutual", asyncHandler(mutual));

export default router;
