import { Request, Response } from "express";
import crypto from "crypto";
import { findEventById, incrementAttendedCount, markDepositPaid } from "../../dblayer/event-queries";
import { findExistingRequest } from "../../dblayer/request-queries";
import { findUserById } from "../../dblayer/user-queries";
import {
  createInitiatedPayment,
  findPaymentByOrderId,
  findInitiatedPaymentForUser,
  findAllInitiatedPaymentsForUser,
  findInitiatedDepositForHost,
  markDepositPaymentCompleted,
  verifyAndAdmit,
  markPaymentFailed,
  findAttendee,
  findPaymentById,
  getUserPayments,
  getCompletedPaymentsForEvent,
  markPaymentRefundedWithDetails,
  getAttendeeWithPayment,
  removeAttendeeAndFreeSlot,
} from "../../dblayer/payment-queries";
import {
  enqueueRefundJob,
  markRefundJobSucceeded,
  markRefundJobFailed,
} from "../../dblayer/financial-ops";
import { findTierById } from "../../dblayer/tier-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";
import { logger } from "../lib/logger";
import { createOrder, getOrder, getOrderPayments } from "../lib/cashfree";
import { calculateUserPlatformFee, calculateUserTotal } from "../lib/fee-calculator";
import { v4 as uuidv4 } from "uuid";

// ============================================
// STEP 1: CREATE CASHFREE PAYMENT ORDER
// POST /api/v1/events/:eventId/pay/initiate
// ============================================
export async function initiatePayment(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  if (event.status !== "upcoming") {
    res.status(400).json({ success: false, error: { code: "INVALID_STATE", message: "Can only pay for upcoming events" } });
    return;
  }

  const request = await findExistingRequest(eventId, userId);
  if (!request || request.status !== "approved") {
    res.status(400).json({ success: false, error: { code: "NOT_APPROVED", message: "You must have an approved request to pay" } });
    return;
  }

  const existingAttendee = await findAttendee(eventId, userId);
  if (existingAttendee) {
    res.status(409).json({ success: false, error: { code: "ALREADY_ATTENDING", message: "You are already attending this event" } });
    return;
  }

  // Idempotency: reuse an existing initiated payment order if the user retries
  const existingPayment = await findInitiatedPaymentForUser(eventId, userId);
  if (existingPayment?.razorpay_order_id) {
    // Fetch the live order from Cashfree to verify its current state
    try {
      const order = await getOrder(existingPayment.razorpay_order_id);
      if (order.order_status === "ACTIVE") {
        // Order is still open — give the same session ID back so the user can complete payment
        res.json({
          success: true,
          data: {
            payment_session_id: order.payment_session_id,
            order_id: order.order_id,
            amount: existingPayment.amount,
            platform_fee: existingPayment.platform_fee,
            ticket_price: event.ticket_price,
          },
        });
        return;
      }

      if (order.order_status === "PAID") {
        // Payment succeeded on Cashfree's side but our verify step never ran.
        // Recover the admission now rather than creating a second order (would be a double charge).
        logger.info("initiatePayment: recovering PAID order", { userId, eventId, orderId: existingPayment.razorpay_order_id });

        const orderPayments = await getOrderPayments(existingPayment.razorpay_order_id);
        const successPayment = orderPayments.find((p) => p.payment_status === "SUCCESS");
        const cfPaymentId = successPayment ? String(successPayment.cf_payment_id) : "cashfree_recovered";

        let admitSlots = 1;
        let admitTierId: string | null = null;
        if (existingPayment.tier_id) {
          const tier = await findTierById(existingPayment.tier_id);
          if (tier) { admitSlots = tier.slots; admitTierId = tier.id; }
        }

        const recoveryResult = await verifyAndAdmit(
          existingPayment.razorpay_order_id,
          cfPaymentId,
          "cashfree_recovered",
          eventId,
          userId,
          admitSlots,
          admitTierId
        );

        if (recoveryResult) {
          await incrementAttendedCount(userId);
          logger.info("initiatePayment: recovery successful — guest admitted", { userId, eventId });
        }

        // Whether recovery just ran or was already done: tell the user their payment succeeded.
        // They should view their ticket instead of paying again.
        res.status(409).json({
          success: false,
          error: {
            code: "PAYMENT_ALREADY_PROCESSED",
            message: "Your previous payment was successful! Open your ticket to see your QR code.",
          },
        });
        return;
      }

      // EXPIRED / CANCELLED / TERMINATION → fall through and create a fresh order below
    } catch {
      // Could not fetch existing order from Cashfree — fall through and create a new one
    }
  }

  // Determine base price from tier (if any) or event default
  const tierId = request.tier_id ?? null;
  let basePrice = event.ticket_price;
  if (tierId) {
    const tier = await findTierById(tierId);
    if (!tier) {
      res.status(404).json({ success: false, error: { code: "TIER_NOT_FOUND", message: "Selected tier no longer exists" } });
      return;
    }
    if (tier.price === 0) {
      res.status(400).json({ success: false, error: { code: "FREE_TIER", message: "This tier is free — no payment needed" } });
      return;
    }
    basePrice = tier.price;
  }

  if (basePrice === 0) {
    res.status(400).json({ success: false, error: { code: "FREE_EVENT", message: "This is a free event — no payment needed" } });
    return;
  }

  // Calculate user-facing total: base price + tiered platform fee
  const platformFee = calculateUserPlatformFee(basePrice);
  const totalAmount = calculateUserTotal(basePrice);

  // Create a Cashfree payment order
  // razorpay_order_id column stores Cashfree order_id
  const user = await findUserById(userId);
  const frontendUrl = process.env.FRONTEND_URL ?? "https://maskedon.com";
  const backendUrl  = process.env.BACKEND_URL  ?? "https://api.maskedon.com";
  const returnUrl = `${frontendUrl}/events/${eventId}`;
  const cfOrderId = uuidv4().replace(/-/g, ""); // 32-char alphanumeric, safe for Cashfree

  let cashfreeOrder: { order_id: string; payment_session_id: string };
  try {
    cashfreeOrder = await createOrder({
      orderId:     cfOrderId,
      amountPaisa: totalAmount,
      purpose:     `maskedon ticket – ${event.title}`.slice(0, 255),
      buyerName:   user?.display_name ?? "Guest",
      email:       user?.email ?? "team@maskedon.com",
      returnUrl,
      notifyUrl:   `${backendUrl}/api/v1/webhooks/cashfree`,
    });
  } catch (orderError: unknown) {
    logger.error("Cashfree order creation failed", orderError);
    res.status(503).json({
      success: false,
      error: { code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable. Please try again in a moment." },
    });
    return;
  }

  // Persist the initiated payment row (razorpay_order_id stores Cashfree order_id)
  await createInitiatedPayment(
    userId,
    event.host_id,
    eventId,
    totalAmount,
    event.currency ?? "INR",
    cashfreeOrder.order_id,
    platformFee,
    "ticket",
    tierId
  );

  res.status(201).json({
    success: true,
    data: {
      payment_session_id: cashfreeOrder.payment_session_id,
      order_id:           cashfreeOrder.order_id,
      amount:             totalAmount,
      platform_fee:       platformFee,
      ticket_price:       basePrice,
    },
  });
}

// ============================================
// STEP 2: VERIFY CASHFREE PAYMENT + ADMIT GUEST
// POST /api/v1/events/:eventId/pay/verify
// Called by the frontend after Cashfree redirects back with ?order_id=<id>
// ============================================
export async function verifyPayment(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const { order_id } = req.body as { order_id: string };

  if (!order_id) {
    res.status(400).json({
      success: false,
      error: { code: "MISSING_FIELDS", message: "order_id is required" },
    });
    return;
  }

  // Verify with Cashfree API — server-to-server, never trust client alone
  let cfOrder: { order_status: string };
  try {
    cfOrder = await getOrder(order_id);
  } catch (verifyError: unknown) {
    logger.warn("Cashfree getOrder failed during verify", { userId, eventId, order_id, error: verifyError });
    res.status(400).json({
      success: false,
      error: { code: "PAYMENT_NOT_VERIFIED", message: "Payment could not be verified. Contact support if you were charged." },
    });
    return;
  }

  if (cfOrder.order_status !== "PAID") {
    res.status(400).json({
      success: false,
      error: { code: "PAYMENT_NOT_COMPLETED", message: `Payment status is '${cfOrder.order_status}'. Contact support if you were charged.` },
    });
    return;
  }

  // Get cf_payment_id from order payments
  const orderPayments = await getOrderPayments(order_id);
  const successPayment = orderPayments.find((p) => p.payment_status === "SUCCESS");
  const cfPaymentId = successPayment ? String(successPayment.cf_payment_id) : "cashfree_verified";

  // Cross-reference: verifyAndAdmit checks payer_id === userId and event_id === eventId
  let admitSlots = 1;
  let admitTierId: string | null = null;
  const paymentRecord = await findPaymentByOrderId(order_id);
  if (paymentRecord?.tier_id) {
    const tier = await findTierById(paymentRecord.tier_id);
    if (tier) {
      admitSlots = tier.slots;
      admitTierId = tier.id;
    }
  }

  const result = await verifyAndAdmit(
    order_id,
    cfPaymentId,
    "cashfree_verified",
    eventId,
    userId,
    admitSlots,
    admitTierId
  );

  if (!result) {
    const existingAttendee = await findAttendee(eventId, userId);
    if (existingAttendee) {
      const payment = await findPaymentByOrderId(order_id);
      res.json({ success: true, data: { payment, attendee: existingAttendee } });
      return;
    }
    res.status(409).json({
      success: false,
      error: { code: "EVENT_FULL", message: "This event just reached full capacity. Contact support for a refund." },
    });
    return;
  }

  const { payment, attendee } = result;
  await incrementAttendedCount(userId);

  const event = await findEventById(eventId);
  if (event) {
    createNotificationWithSocket(
      event.host_id,
      "payment_received",
      "New attendee!",
      `Someone paid and confirmed their spot at "${event.title}"`,
      eventId,
      "event"
    ).catch(() => {});
  }

  res.json({ success: true, data: { payment, attendee } });
}

// ============================================
// TICKET RECOVERY
// POST /api/v1/events/:eventId/payment/recover
//
// Called when: user paid but our verify step failed (network error,
// app backgrounded on mobile, wrong FRONTEND_URL redirect, etc.).
// Checks Cashfree server-side and admits the user if payment is confirmed.
// Safe to call multiple times — verifyAndAdmit is idempotent.
// ============================================
export async function recoverTicket(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId  = req.user!.userId;

  // If user already has a ticket, nothing to recover
  const existingAttendee = await findAttendee(eventId, userId);
  if (existingAttendee) {
    res.json({ success: true, data: { recovered: false, already_attending: true } });
    return;
  }

  // Fetch ALL initiated payments for this user+event (newest first).
  // We must scan all of them because users sometimes create a second order
  // (e.g. the app reloads and the idempotency check briefly sees the old order
  // as ACTIVE before the payment lands), meaning the newest DB row may be an
  // ACTIVE order even though an older order was actually paid.
  const payments = await findAllInitiatedPaymentsForUser(eventId, userId);
  if (!payments.length) {
    res.status(404).json({
      success: false,
      error: { code: "NO_PAYMENT", message: "No pending payment found. Please contact support if you were charged." },
    });
    return;
  }

  // Walk the list (newest → oldest) until we find a PAID order in Cashfree
  let payment: typeof payments[0] | null = null;
  let cfOrder: { order_status: string; order_id: string } | null = null;
  let lastError: string | null = null;

  for (const p of payments) {
    if (!p.razorpay_order_id) continue;
    try {
      const order = await getOrder(p.razorpay_order_id) as { order_status: string; order_id: string };
      if (order.order_status === "PAID") {
        payment = p;
        cfOrder = order;
        break; // found the paid order — stop searching
      }
      lastError = order.order_status; // e.g. "ACTIVE", "EXPIRED"
    } catch (err) {
      // Cashfree couldn't return this order — log and try the next one
      logger.warn("recoverTicket: getOrder failed for one order, trying next", {
        orderId: p.razorpay_order_id,
        error: err instanceof Error ? err.message : String(err),
      });
      lastError = "SERVICE_ERROR";
    }
  }

  if (!cfOrder || !payment) {
    // No paid order found among all initiated payments
    if (lastError === "SERVICE_ERROR") {
      res.status(503).json({
        success: false,
        error: { code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Could not reach payment service. Try again in a moment." },
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: "PAYMENT_NOT_COMPLETED",
          message: lastError
            ? `Payment status is '${lastError}'. If you believe you were charged, contact support.`
            : "No completed payment found. If you were charged, please contact support.",
        },
      });
    }
    return;
  }

  // payment.razorpay_order_id is guaranteed non-null here: the loop only sets
  // `payment` when it skips entries where razorpay_order_id is falsy.
  const paidOrderId = payment.razorpay_order_id!;

  // Get the real cf_payment_id for proper record-keeping
  const orderPayments = await getOrderPayments(paidOrderId);
  const successPayment = orderPayments.find((p) => p.payment_status === "SUCCESS");
  const cfPaymentId = successPayment ? String(successPayment.cf_payment_id) : "cashfree_recovered";

  // Resolve slots from tier
  let admitSlots = 1;
  let admitTierId: string | null = null;
  if (payment.tier_id) {
    const tier = await findTierById(payment.tier_id);
    if (tier) { admitSlots = tier.slots; admitTierId = tier.id; }
  }

  // Atomically admit the user (idempotent — safe if already done)
  const result = await verifyAndAdmit(
    paidOrderId,
    cfPaymentId,
    "cashfree_recovered",
    eventId,
    userId,
    admitSlots,
    admitTierId
  );

  if (!result) {
    // verifyAndAdmit returns null when event is full or payment was already processed
    const stillAttending = await findAttendee(eventId, userId);
    if (stillAttending) {
      res.json({ success: true, data: { recovered: true, already_attending: true } });
      return;
    }
    res.status(409).json({
      success: false,
      error: {
        code: "RECOVERY_FAILED",
        message: "Could not recover ticket — the event may be full. Contact support with your payment details.",
      },
    });
    return;
  }

  await incrementAttendedCount(userId);
  logger.info("recoverTicket: guest admitted via manual recovery", { userId, eventId });

  res.json({ success: true, data: { recovered: true, payment: result.payment, attendee: result.attendee } });
}

// ============================================
// CASHFREE WEBHOOK HANDLER
// POST /api/v1/webhooks/cashfree
// Belt-and-suspenders: admits guest if frontend verify never fired.
// Cashfree sends JSON body.
// Signature = base64(HMAC-SHA256(SECRET_KEY, timestamp + rawBody))
// ============================================
export async function cashfreeWebhook(req: Request, res: Response) {
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  if (!secretKey) {
    if (process.env.NODE_ENV === "production") {
      logger.error("CASHFREE_SECRET_KEY not configured in production");
      res.status(500).send("Webhook not configured");
      return;
    }
    logger.warn("CASHFREE_SECRET_KEY not configured — webhook ignored");
    res.status(200).send("ok");
    return;
  }

  const timestamp    = req.headers["x-webhook-timestamp"] as string | undefined;
  const receivedSig  = req.headers["x-webhook-signature"] as string | undefined;
  const rawBody      = req.body as Buffer; // express.raw() gives a Buffer

  if (!timestamp || !receivedSig || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    res.status(400).send("Missing webhook headers or body");
    return;
  }

  // Cashfree signature = base64(HMAC-SHA256(SECRET_KEY, timestamp + rawBody))
  const message     = timestamp + rawBody.toString("utf8");
  const expectedSig = crypto.createHmac("sha256", secretKey).update(message).digest("base64");

  if (receivedSig !== expectedSig) {
    logger.warn("Invalid Cashfree webhook signature");
    res.status(400).send("Invalid signature");
    return;
  }

  // Acknowledge immediately — Cashfree retries on non-2xx
  res.status(200).send("ok");

  try {
    const payload = JSON.parse(rawBody.toString("utf8")) as any;

    if (payload.type === "PAYMENT_SUCCESS_WEBHOOK") {
      const orderId     = payload.data.order.order_id;
      const cfPaymentId = String(payload.data.payment.cf_payment_id);
      const existingPayment = await findPaymentByOrderId(orderId);
      if (!existingPayment || existingPayment.status !== "initiated") return;

      const result = await verifyAndAdmit(
        orderId,
        cfPaymentId,
        "cashfree_webhook_verified",
        existingPayment.event_id,
        existingPayment.payer_id
      );

      if (result) {
        await incrementAttendedCount(existingPayment.payer_id);
        logger.info("Cashfree webhook: guest admitted via fallback", {
          orderId,
          userId: existingPayment.payer_id,
        });
      }
    } else if (payload.type === "PAYMENT_FAILED_WEBHOOK") {
      const orderId     = payload.data.order.order_id;
      const existingPayment = await findPaymentByOrderId(orderId);
      if (existingPayment?.status === "initiated") {
        await markPaymentFailed(orderId);
        logger.info("Cashfree webhook: payment failed", { orderId });
      }
    } else if (payload.type === "REFUND_SUCCESS_WEBHOOK") {
      const refundData = payload.data?.refund;
      if (refundData) {
        const refundJobId = refundData.refund_id;
        const cfRefundId = String(refundData.cf_refund_id);
        const refundAmountRupees = refundData.refund_amount;
        const refundAmountPaisa = Math.round(refundAmountRupees * 100);

        const { query: dbQuery } = require("../../dblayer/connection");
        const jobResult = await dbQuery("SELECT * FROM refund_jobs WHERE id = ?", [refundJobId]);
        const job = jobResult.rows[0];
        if (job) {
          await markRefundJobSucceeded(refundJobId, cfRefundId);
          await markPaymentRefundedWithDetails(job.payment_id, cfRefundId, refundAmountPaisa, "refunded");
          await dbQuery("UPDATE refund_requests SET status = 'approved' WHERE payment_id = ?", [job.payment_id]);
          logger.info("Cashfree webhook: refund success", { refundJobId, cfRefundId });
        }
      }
    } else if (payload.type === "REFUND_FAILED_WEBHOOK") {
      const refundData = payload.data?.refund;
      if (refundData) {
        const refundJobId = refundData.refund_id;
        const lastError = refundData.status_description || "Refund failed via webhook";

        const { query: dbQuery } = require("../../dblayer/connection");
        const jobResult = await dbQuery("SELECT * FROM refund_jobs WHERE id = ?", [refundJobId]);
        const job = jobResult.rows[0];
        if (job) {
          await markRefundJobFailed(refundJobId, lastError);
          await markPaymentRefundedWithDetails(job.payment_id, null, 0, "refund_failed");
          logger.info("Cashfree webhook: refund failed", { refundJobId, error: lastError });
        }
      }
    }
  } catch (webhookProcessError: unknown) {
    logger.error("Error processing Cashfree webhook", webhookProcessError);
    // Do NOT re-throw — already sent 200
  }
}

// ============================================
// EXISTING ENDPOINTS (unchanged)
// ============================================

// GET /api/v1/payments/:paymentId
export async function getPayment(req: Request, res: Response) {
  const payment = await findPaymentById(req.params.paymentId as string);

  if (!payment) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Payment not found" } });
    return;
  }

  if (payment.payer_id !== req.user!.userId && payment.host_id !== req.user!.userId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "You cannot view this payment" } });
    return;
  }

  res.json({ success: true, data: { payment } });
}

// GET /api/v1/users/me/payments
export async function myPayments(req: Request, res: Response) {
  const payments = await getUserPayments(req.user!.userId);
  res.json({ success: true, data: { payments } });
}

// ============================================
// GUEST TICKET CANCELLATION
// DELETE /api/v1/events/:eventId/attend
// ============================================
export async function cancelTicket(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  if (event.status !== "upcoming") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_STATE", message: "You can only cancel a ticket for an upcoming event" },
    });
    return;
  }

  const attendeeWithPayment = await getAttendeeWithPayment(eventId, userId);
  if (!attendeeWithPayment) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_ATTENDING", message: "You are not attending this event" },
    });
    return;
  }

  // Calculate refund tier based on hours until event start
  const hoursUntilEvent = (new Date(event.date_time).getTime() - Date.now()) / 3_600_000;
  let refundPercent = 0;
  if (hoursUntilEvent >= 48) {
    refundPercent = 100;
  } else if (hoursUntilEvent >= 12) {
    refundPercent = 50;
  }
  
  const payment = attendeeWithPayment.payment;
  let refundedAmount = 0;
  let isReviewRequired = false;

  if (payment?.status === "completed" && refundPercent > 0) {
    const amountToRefund = Math.floor(payment.amount * (refundPercent / 100));
    const refundRequestId = uuidv4();
    const reason = (req.body.reason || "Guest cancellation").substring(0, 1000);
    
    const { query: dbQuery } = require("../../dblayer/connection");
    await dbQuery(
      `INSERT INTO refund_requests (id, payment_id, event_id, user_id, amount, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending_review')`,
      [refundRequestId, payment.id, eventId, userId, amountToRefund, reason]
    );

    logger.info("Guest ticket cancellation — refund request created for review", {
      refundRequestId,
      paymentId: payment.id,
      payerUserId: userId,
      amountPaisaToRefund: amountToRefund,
      refundPercent,
    });

    refundedAmount = amountToRefund;
    isReviewRequired = true;
  } else if (payment?.status === "completed" && refundPercent === 0) {
    // No refund due (< 12h window) — mark as refunded with 0 amount
    await markPaymentRefundedWithDetails(payment.id, null, 0, "refunded");
  }

  // Remove attendee and free the capacity slot atomically
  await removeAttendeeAndFreeSlot(eventId, userId);

  // Notify host
  createNotificationWithSocket(
    event.host_id,
    "event_request",
    "Guest cancelled",
    `A guest cancelled their ticket for "${event.title}"`,
    eventId,
    "event"
  ).catch(() => {});

  const refundMessage = isReviewRequired
    ? `Refund request of ₹${(refundedAmount / 100).toFixed(2)} (${refundPercent}%) submitted for admin review.`
    : payment?.status === "completed" && refundPercent === 0
      ? "No refund applies (cancellation within 12 hours of event)."
      : "";

  res.json({
    success: true,
    data: {
      message: `Ticket cancelled. ${refundMessage}`,
      refund_percent: refundPercent,
      refunded_amount: refundedAmount,
      refund_review_required: isReviewRequired,
    },
  });
}

// ============================================
// EVENT CANCELLATION — ISSUE REAL REFUNDS
// Called by event-controller when host cancels
// ============================================
export async function issueRefundsForEvent(eventId: string): Promise<void> {
  const completedPayments = await getCompletedPaymentsForEvent(eventId);

  for (const payment of completedPayments) {
    await enqueueRefundJob(payment.id, payment.amount);
    logger.info("Event cancelled — refund job queued", {
      paymentId: payment.id,
      payerUserId: payment.payer_id,
      amountPaisa: payment.amount,
      cashfreePaymentId: payment.razorpay_payment_id, // cf_payment_id stored here
    });
  }
}

// ============================================
// DEPOSIT: CREATE ORDER
// POST /api/v1/events/:eventId/deposit/initiate
// ============================================
export async function initiateDeposit(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const hostId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  if (event.host_id !== hostId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only the host can pay the deposit" } });
    return;
  }

  if (event.deposit_status === "not_required") {
    res.status(400).json({ success: false, error: { code: "NO_DEPOSIT_REQUIRED", message: "No deposit is required for free events" } });
    return;
  }

  if (event.deposit_status === "paid") {
    res.json({ success: true, data: { already_paid: true, deposit_amount: event.deposit_amount } });
    return;
  }

  // Idempotency: reuse existing initiated deposit order
  const existing = await findInitiatedDepositForHost(eventId, hostId);
  if (existing?.razorpay_order_id) {
    try {
      const order = await getOrder(existing.razorpay_order_id);
      if (order.order_status === "ACTIVE") {
        res.json({
          success: true,
          data: {
            payment_session_id: order.payment_session_id,
            order_id: order.order_id,
            amount: existing.amount,
          },
        });
        return;
      }
    } catch {
      // Fall through and create a fresh order
    }
  }

  const host = await findUserById(hostId);
  const frontendUrl = process.env.FRONTEND_URL ?? "https://maskedon.com";
  const returnUrl = `${frontendUrl}/events/${eventId}?deposit=complete`;
  const cfDepositOrderId = uuidv4().replace(/-/g, "");

  let depositOrder: { order_id: string; payment_session_id: string };
  try {
    depositOrder = await createOrder({
      orderId:     cfDepositOrderId,
      amountPaisa: event.deposit_amount,
      purpose:     `maskedon host deposit – ${event.title}`.slice(0, 255),
      buyerName:   host?.display_name ?? "Host",
      email:       host?.email ?? "team@maskedon.com",
      returnUrl,
    });
  } catch (err: unknown) {
    logger.error("Cashfree deposit order creation failed", err);
    res.status(503).json({ success: false, error: { code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable. Please try again." } });
    return;
  }

  await createInitiatedPayment(
    hostId,
    hostId,
    eventId,
    event.deposit_amount,
    event.currency ?? "INR",
    depositOrder.order_id,
    0,
    "deposit"
  );

  res.status(201).json({
    success: true,
    data: {
      payment_session_id: depositOrder.payment_session_id,
      order_id:           depositOrder.order_id,
      amount:             event.deposit_amount,
    },
  });
}

// ============================================
// DEPOSIT: VERIFY (CASHFREE)
// POST /api/v1/events/:eventId/deposit/verify
// ============================================
export async function verifyDeposit(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const hostId = req.user!.userId;

  const { order_id } = req.body as { order_id: string };

  if (!order_id) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "order_id is required" } });
    return;
  }

  const event = await findEventById(eventId);
  if (!event || event.host_id !== hostId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not authorized" } });
    return;
  }

  if (event.deposit_status === "paid") {
    res.json({ success: true, data: { already_paid: true } });
    return;
  }

  // Verify with Cashfree API — server-to-server
  let cfOrder: { order_status: string };
  try {
    cfOrder = await getOrder(order_id);
  } catch (verifyError: unknown) {
    logger.warn("Cashfree deposit order fetch failed", { hostId, eventId, order_id, error: verifyError });
    res.status(400).json({ success: false, error: { code: "PAYMENT_NOT_VERIFIED", message: "Deposit verification failed. Contact support if you were charged." } });
    return;
  }

  if (cfOrder.order_status !== "PAID") {
    res.status(400).json({ success: false, error: { code: "PAYMENT_NOT_COMPLETED", message: `Deposit status is '${cfOrder.order_status}'.` } });
    return;
  }

  const orderPayments = await getOrderPayments(order_id);
  const successPmt = orderPayments.find((p) => p.payment_status === "SUCCESS");
  const cfPaymentId = successPmt ? String(successPmt.cf_payment_id) : "cashfree_deposit_verified";

  const payment = await markDepositPaymentCompleted(order_id, cfPaymentId, "cashfree_deposit_verified");
  if (!payment) {
    res.status(409).json({ success: false, error: { code: "PAYMENT_NOT_FOUND", message: "Deposit payment record not found" } });
    return;
  }

  await markDepositPaid(eventId, payment.id);

  res.json({ success: true, data: { deposit_paid: true, deposit_amount: event.deposit_amount } });
}
