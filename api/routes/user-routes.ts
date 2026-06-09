import { Router } from "express";
import { getMe, updateMe, getUserProfile, uploadAvatar, avatarUpload, uploadBanner, bannerUpload, registerPushToken, changePassword, deleteAccount } from "../controllers/user-controller";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { sharedCache, privateCache } from "../middleware/cache-response";
import { asyncHandler } from "../utils/async-handler";
import { myHostedEvents, hostAnalytics } from "../controllers/event-controller";
import { myRequests, myHostRequests } from "../controllers/request-controller";
import { myPayments } from "../controllers/payment-controller";
import { userRatings, userTrustLevel, pendingRatings } from "../controllers/rating-controller";
import { listUserPhotos } from "../controllers/photo-controller";
import { submitIdVerification, idDocUpload } from "../controllers/id-verification-controller";
import { listMyTickets } from "../controllers/ticket-controller";
import {
  profileUpdateLimiter,
  avatarUploadLimiter,
  bannerUploadLimiter,
  passwordChangeLimiter,
  deleteAccountLimiter,
  idVerificationLimiter,
} from "../middleware/rate-limiters";

const router = Router();

router.param("userId", validateUUIDParam);

// All user routes require authentication
router.use(authenticate);

router.get("/me", asyncHandler(getMe));
router.put("/me", profileUpdateLimiter, asyncHandler(updateMe));
router.put("/me/avatar", avatarUploadLimiter, avatarUpload.single("avatar"), asyncHandler(uploadAvatar));
router.put("/me/banner", bannerUploadLimiter, bannerUpload.single("banner"), asyncHandler(uploadBanner));
router.post("/me/push-token", asyncHandler(registerPushToken));
router.put("/me/password", passwordChangeLimiter, asyncHandler(changePassword));
router.delete("/me", deleteAccountLimiter, asyncHandler(deleteAccount));
router.post("/me/id-verification", idVerificationLimiter, idDocUpload.single("document"), asyncHandler(submitIdVerification));
router.get("/me/events", privateCache(3 * 60_000), asyncHandler(myHostedEvents));
router.get("/me/host-analytics", privateCache(3 * 60_000), asyncHandler(hostAnalytics));
router.get("/me/requests", asyncHandler(myRequests));
router.get("/me/host-requests", asyncHandler(myHostRequests));
router.get("/me/payments", asyncHandler(myPayments));
router.get("/me/tickets", asyncHandler(listMyTickets));
router.get("/me/pending-ratings", asyncHandler(pendingRatings));
router.get("/:userId", sharedCache(5 * 60_000), asyncHandler(getUserProfile));
router.get("/:userId/ratings", sharedCache(3 * 60_000), asyncHandler(userRatings));
router.get("/:userId/trust-level", sharedCache(5 * 60_000), asyncHandler(userTrustLevel));
router.get("/:userId/photos", asyncHandler(listUserPhotos));

export default router;
