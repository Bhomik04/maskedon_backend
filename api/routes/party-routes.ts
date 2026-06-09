import { Router } from "express";
import { authenticate, optionalAuthenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { sharedCache } from "../middleware/cache-response";
import { asyncHandler } from "../utils/async-handler";
import * as partyCtrl from "../controllers/party-controller";
import * as requestCtrl from "../controllers/request-controller";
import * as messagesCtrl from "../controllers/messages-controller";
import * as paymentCtrl from "../controllers/payment-controller";
import * as ratingCtrl from "../controllers/rating-controller";
import * as photoCtrl from "../controllers/photo-controller";
import * as ticketCtrl from "../controllers/ticket-controller";
import * as tierCtrl from "../controllers/tier-controller";
import {
  createPartyLimiter,
  joinRequestLimiter,
  paymentLimiter,
  crowdRatingLimiter,
} from "../middleware/rate-limiters";

const router = Router();

router.param("partyId", validateUUIDParam);
router.param("requestId", validateUUIDParam);
router.param("tierId", validateUUIDParam);
router.param("attendeeId", validateUUIDParam);

// Party CRUD
router.post("/", authenticate, createPartyLimiter, partyCtrl.upload.single("cover_image"), asyncHandler(partyCtrl.create));
router.get("/", optionalAuthenticate, sharedCache(60_000), asyncHandler(partyCtrl.discover));
router.get("/tags/suggestions", optionalAuthenticate, sharedCache(60_000), asyncHandler(partyCtrl.getTagSuggestions));
// Private party lookup — must be before /:partyId to avoid UUID validation
router.get("/private/:code", authenticate, asyncHandler(partyCtrl.findByPrivateCode));
router.get("/:partyId", optionalAuthenticate, asyncHandler(partyCtrl.getParty));
router.put("/:partyId", authenticate, partyCtrl.upload.single("cover_image"), asyncHandler(partyCtrl.update));
router.patch("/:partyId/cancel", authenticate, asyncHandler(partyCtrl.cancel));
router.get("/:partyId/attendees", authenticate, asyncHandler(partyCtrl.listAttendees));
router.get("/:partyId/announcements", authenticate, asyncHandler(messagesCtrl.listAnnouncements));
router.post("/:partyId/announcements", authenticate, asyncHandler(messagesCtrl.createAnnouncement));

// Join requests
router.post("/:partyId/requests", authenticate, joinRequestLimiter, asyncHandler(requestCtrl.requestToJoin));
router.get("/:partyId/requests", authenticate, asyncHandler(requestCtrl.listRequests));
router.patch("/:partyId/requests/:requestId", authenticate, asyncHandler(requestCtrl.handleRequest));
router.delete("/:partyId/requests/:requestId", authenticate, asyncHandler(requestCtrl.withdraw));

// Ticket tiers (pricing)
router.get("/:partyId/tiers", optionalAuthenticate, asyncHandler(tierCtrl.listTiers));
router.post("/:partyId/tiers", authenticate, asyncHandler(tierCtrl.createPartyTier));
router.post("/:partyId/tiers/bulk", authenticate, asyncHandler(tierCtrl.bulkCreateTiers));
router.put("/:partyId/tiers/:tierId", authenticate, asyncHandler(tierCtrl.updatePartyTier));
router.delete("/:partyId/tiers/:tierId", authenticate, asyncHandler(tierCtrl.deletePartyTier));

// Group slot assignment
router.post("/:partyId/attendees/:attendeeId/assign", authenticate, asyncHandler(tierCtrl.assignSlot));

// Payment — two-step Razorpay flow (ticket)
router.post("/:partyId/pay/initiate", authenticate, paymentLimiter, asyncHandler(paymentCtrl.initiatePayment));
router.post("/:partyId/pay/verify", authenticate, paymentLimiter, asyncHandler(paymentCtrl.verifyPayment));
router.delete("/:partyId/attend", authenticate, asyncHandler(paymentCtrl.cancelTicket));

// Host deposit — two-step Razorpay flow
router.post("/:partyId/deposit/initiate", authenticate, paymentLimiter, asyncHandler(paymentCtrl.initiateDeposit));
router.post("/:partyId/deposit/verify", authenticate, paymentLimiter, asyncHandler(paymentCtrl.verifyDeposit));

// Ticket: guest views QR ticket; host scans it
router.get("/:partyId/my-ticket", authenticate, asyncHandler(ticketCtrl.getTicket));
router.post("/:partyId/scan-ticket", authenticate, asyncHandler(ticketCtrl.scanTicket));

// Crowd Ratings
router.post("/:partyId/ratings/crowd", authenticate, crowdRatingLimiter, asyncHandler(ratingCtrl.rateCrowd));
router.get("/:partyId/ratings", authenticate, asyncHandler(ratingCtrl.partyRatings));

// Party photos
router.get("/:partyId/photos", authenticate, asyncHandler(photoCtrl.listPartyPhotos));

export default router;
