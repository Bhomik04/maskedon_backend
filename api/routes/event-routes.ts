import { Router } from "express";
import { authenticate, optionalAuthenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { sharedCache } from "../middleware/cache-response";
import { asyncHandler } from "../utils/async-handler";
import * as eventCtrl from "../controllers/event-controller";
import * as requestCtrl from "../controllers/request-controller";
import * as messagesCtrl from "../controllers/messages-controller";
import * as paymentCtrl from "../controllers/payment-controller";
import * as ratingCtrl from "../controllers/rating-controller";
import * as photoCtrl from "../controllers/photo-controller";
import * as ticketCtrl from "../controllers/ticket-controller";
import * as tierCtrl from "../controllers/tier-controller";
import {
  createEventLimiter,
  joinRequestLimiter,
  paymentLimiter,
  crowdRatingLimiter,
} from "../middleware/rate-limiters";

const router = Router();

router.param("eventId", validateUUIDParam);
router.param("requestId", validateUUIDParam);
router.param("tierId", validateUUIDParam);
router.param("attendeeId", validateUUIDParam);

// Event CRUD
router.post("/", authenticate, createEventLimiter, eventCtrl.upload.single("cover_image"), asyncHandler(eventCtrl.create));
router.get("/", optionalAuthenticate, sharedCache(60_000), asyncHandler(eventCtrl.discover));
router.get("/tags/suggestions", optionalAuthenticate, sharedCache(60_000), asyncHandler(eventCtrl.getTagSuggestions));
// Private event lookup — must be before /:eventId to avoid UUID validation
router.get("/private/:code", authenticate, asyncHandler(eventCtrl.findByPrivateCode));
router.get("/:eventId", optionalAuthenticate, asyncHandler(eventCtrl.getEvent));
router.put("/:eventId", authenticate, eventCtrl.upload.single("cover_image"), asyncHandler(eventCtrl.update));
router.patch("/:eventId/cancel", authenticate, asyncHandler(eventCtrl.cancel));
router.get("/:eventId/attendees", authenticate, asyncHandler(eventCtrl.listAttendees));
router.get("/:eventId/announcements", authenticate, asyncHandler(messagesCtrl.listAnnouncements));
router.post("/:eventId/announcements", authenticate, asyncHandler(messagesCtrl.createAnnouncement));

// Join requests
router.post("/:eventId/requests", authenticate, joinRequestLimiter, asyncHandler(requestCtrl.requestToJoin));
router.get("/:eventId/requests", authenticate, asyncHandler(requestCtrl.listRequests));
router.patch("/:eventId/requests/:requestId", authenticate, asyncHandler(requestCtrl.handleRequest));
router.delete("/:eventId/requests/:requestId", authenticate, asyncHandler(requestCtrl.withdraw));

// Ticket tiers (pricing)
router.get("/:eventId/tiers", optionalAuthenticate, asyncHandler(tierCtrl.listTiers));
router.post("/:eventId/tiers", authenticate, asyncHandler(tierCtrl.createEventTier));
router.post("/:eventId/tiers/bulk", authenticate, asyncHandler(tierCtrl.bulkCreateTiers));
router.put("/:eventId/tiers/:tierId", authenticate, asyncHandler(tierCtrl.updateEventTier));
router.delete("/:eventId/tiers/:tierId", authenticate, asyncHandler(tierCtrl.deleteEventTier));

// Group slot assignment
router.post("/:eventId/attendees/:attendeeId/assign", authenticate, asyncHandler(tierCtrl.assignSlot));

// Payment — two-step Cashfree flow (ticket)
router.post("/:eventId/pay/initiate", authenticate, paymentLimiter, asyncHandler(paymentCtrl.initiatePayment));
router.post("/:eventId/pay/verify",   authenticate, paymentLimiter, asyncHandler(paymentCtrl.verifyPayment));
router.post("/:eventId/payment/recover", authenticate, paymentLimiter, asyncHandler(paymentCtrl.recoverTicket));
router.delete("/:eventId/attend", authenticate, asyncHandler(paymentCtrl.cancelTicket));

// Host deposit — two-step Razorpay flow
router.post("/:eventId/deposit/initiate", authenticate, paymentLimiter, asyncHandler(paymentCtrl.initiateDeposit));
router.post("/:eventId/deposit/verify", authenticate, paymentLimiter, asyncHandler(paymentCtrl.verifyDeposit));

// Ticket: guest views QR ticket; host scans it
router.get("/:eventId/my-ticket", authenticate, asyncHandler(ticketCtrl.getTicket));
router.post("/:eventId/scan-ticket", authenticate, asyncHandler(ticketCtrl.scanTicket));

// Crowd Ratings
router.post("/:eventId/ratings/crowd", authenticate, crowdRatingLimiter, asyncHandler(ratingCtrl.rateCrowd));
router.get("/:eventId/ratings", authenticate, asyncHandler(ratingCtrl.eventRatings));

// Event photos
router.get("/:eventId/photos", authenticate, asyncHandler(photoCtrl.listEventPhotos));

export default router;
