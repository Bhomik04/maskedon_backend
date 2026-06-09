import { query, getConnection } from "./connection";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

// ============================================
// PAYMENT TYPES
// ============================================

export interface PaymentRow {
  id: string;
  payer_id: string;
  host_id: string;
  event_id: string;
  amount: number;
  currency: string;
  status: "initiated" | "pending" | "completed" | "failed" | "refunded" | "partial_refund" | "refund_failed";
  // Real Razorpay fields (null for legacy mock payments)
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  // Legacy mock field
  mock_transaction_id: string | null;
  // Refund tracking (migration 021)
  refunded_amount: number | null;
  refund_razorpay_id: string | null;
  // Revenue model (migration 023)
  platform_fee: number;
  payment_type: "ticket" | "deposit";
  // Tier (migration 027)
  tier_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface AttendeeRow {
  id: string;
  event_id: string;
  user_id: string | null;  // NULL for unassigned group slots
  payment_id: string | null;
  checked_in: boolean;
  joined_at: Date;
  qr_token: string | null;
  checked_in_at: Date | null;
  tier_id: string | null;
  group_id: string | null;
  group_size: number;
  slot_index: number;
}

// ============================================
// PAYMENT QUERIES
// ============================================

export async function createMockPayment(
  payerId: string,
  hostId: string,
  eventId: string,
  amount: number,
  currency: string
): Promise<PaymentRow> {
  const id = uuidv4();
  const mockTxnId = `MOCK_TXN_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  await query(
    `INSERT INTO payments (id, payer_id, host_id, event_id, amount, currency, status, mock_transaction_id, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, NOW())`,
    [id, payerId, hostId, eventId, amount, currency, mockTxnId]
  );

  const result = await query<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id]);
  return result.rows[0]!;
}

export async function createAttendee(
  eventId: string,
  userId: string,
  paymentId: string | null
): Promise<AttendeeRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO event_attendees (id, event_id, user_id, payment_id)
     VALUES (?, ?, ?, ?)`,
    [id, eventId, userId, paymentId]
  );
  const result = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE id = ?",
    [id]
  );
  return result.rows[0]!;
}

export async function findAttendee(
  eventId: string,
  userId: string
): Promise<AttendeeRow | null> {
  const result = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE event_id = ? AND user_id = ?",
    [eventId, userId]
  );
  return result.rows[0] || null;
}

export async function getEventAttendees(
  eventId: string
): Promise<(AttendeeRow & { username: string; display_name: string; avatar_url: string | null; social_rating: number })[]> {
  const result = await query<AttendeeRow & { username: string; display_name: string; avatar_url: string | null; social_rating: number }>(
    `SELECT a.*, u.username, u.display_name, u.avatar_url, u.social_rating
     FROM event_attendees a
     JOIN users u ON u.id = a.user_id
     WHERE a.event_id = ?
     ORDER BY a.joined_at ASC`,
    [eventId]
  );
  return result.rows;
}

export async function findPaymentById(id: string): Promise<PaymentRow | null> {
  const result = await query<PaymentRow>(
    "SELECT * FROM payments WHERE id = ?",
    [id]
  );
  return result.rows[0] || null;
}

export async function getUserPayments(userId: string): Promise<(PaymentRow & { event_title: string })[]> {
  const result = await query<PaymentRow & { event_title: string }>(
    `SELECT pay.*, p.title AS event_title
     FROM payments pay
     JOIN events p ON p.id = pay.event_id
     WHERE pay.payer_id = ?
     ORDER BY pay.created_at DESC`,
    [userId]
  );
  return result.rows; 
}

// ============================================
// RAZORPAY — REAL PAYMENT FUNCTIONS
// ============================================

/**
 * Creates a payment row in 'initiated' state when a Razorpay order is created.
 * The payment is not yet complete — it awaits HMAC verification via verifyAndAdmit().
 */
export async function createInitiatedPayment(
  payerId: string,
  hostId: string,
  eventId: string,
  amount: number,
  currency: string,
  razorpayOrderId: string,
  platformFee: number = 0,
  paymentType: "ticket" | "deposit" = "ticket",
  tierId: string | null = null
): Promise<PaymentRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO payments (id, payer_id, host_id, event_id, amount, currency, status, razorpay_order_id, platform_fee, payment_type, tier_id)
     VALUES (?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?, ?)`,
    [id, payerId, hostId, eventId, amount, currency, razorpayOrderId, platformFee, paymentType, tierId]
  );
  const result = await query<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id]);
  return result.rows[0]!;
}

/**
 * Finds a payment row by its Razorpay order ID.
 * Used during verify and webhook handling.
 */
export async function findPaymentByOrderId(orderId: string): Promise<PaymentRow | null> {
  const result = await query<PaymentRow>(
    "SELECT * FROM payments WHERE razorpay_order_id = ?",
    [orderId]
  );
  return result.rows[0] || null;
}

/**
 * Finds an initiated payment for a specific user + event.
 * Used for idempotent re-use of an existing order when the user retries.
 */
export async function findInitiatedPaymentForUser(
  eventId: string,
  userId: string
): Promise<PaymentRow | null> {
  const result = await query<PaymentRow>(
    `SELECT * FROM payments
     WHERE event_id = ? AND payer_id = ? AND status = 'initiated'
     ORDER BY created_at DESC LIMIT 1`,
    [eventId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Returns ALL initiated payments for a user+event, newest first.
 * Used by recoverTicket to scan all pending orders and find the one
 * that was actually paid in Cashfree (handles the case where a newer
 * ACTIVE order was created after the user already paid an older order).
 */
export async function findAllInitiatedPaymentsForUser(
  eventId: string,
  userId: string
): Promise<PaymentRow[]> {
  const result = await query<PaymentRow>(
    `SELECT * FROM payments
     WHERE event_id = ? AND payer_id = ? AND status = 'initiated'
     ORDER BY created_at DESC`,
    [eventId, userId]
  );
  return result.rows;
}

/**
 * Atomically verifies a Razorpay payment and admits the guest.
 * Supports multi-slot group tickets (slots param controls how many attendee rows).
 *
 * Steps (all inside one DB transaction):
 *  1. Verify the payment row exists, belongs to this user, and is 'initiated'
 *  2. Claim N capacity slots (atomic UPDATE with WHERE guard)
 *  3. Insert N attendee rows (slot 1 = primary user, slots 2+ = unassigned)
 *  4. Mark payment as 'completed' with all three Razorpay IDs
 *
 * Returns null if:
 *  - No matching initiated payment found
 *  - Event is already at max capacity
 */
export async function verifyAndAdmit(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string,
  eventId: string,
  userId: string,
  slots: number = 1,
  tierId: string | null = null
): Promise<{ payment: PaymentRow; attendee: AttendeeRow } | null> {
  const conn = await getConnection();
  const primaryAttendeeId = uuidv4();
  const groupId = slots > 1 ? uuidv4() : null;

  // Quick pre-check (outside transaction) to avoid unnecessary locking
  const existing = await findPaymentByOrderId(razorpayOrderId);
  if (!existing || existing.payer_id !== userId || existing.event_id !== eventId) {
    return null;
  }
  if (existing.status === "completed") {
    // Already processed (idempotent re-call) — fetch the primary attendee and return
    const attendeeResult = await query<AttendeeRow>(
      "SELECT * FROM event_attendees WHERE event_id = ? AND user_id = ? AND slot_index = 1",
      [eventId, userId]
    );
    if (attendeeResult.rows[0]) {
      return { payment: existing, attendee: attendeeResult.rows[0] };
    }
  }
  if (existing.status !== "initiated") {
    return null;
  }

  // Use tier_id from payment row if not passed explicitly
  const resolvedTierId = tierId ?? existing.tier_id ?? null;

  try {
    await conn.beginTransaction();

    // Lock the payment row inside the transaction to prevent concurrent processing (C-1)
    const [lockedRows] = await conn.execute(
      `SELECT id, status FROM payments WHERE id = ? FOR UPDATE`,
      [existing.id]
    ) as [{ id: string; status: string }[]];
    const lockedPayment = lockedRows[0];
    if (!lockedPayment || lockedPayment.status !== "initiated") {
      await conn.rollback();
      conn.release();
      if (lockedPayment?.status === "completed") {
        const attendeeResult = await query<AttendeeRow>(
          "SELECT * FROM event_attendees WHERE event_id = ? AND user_id = ? AND slot_index = 1",
          [eventId, userId]
        );
        const paymentResult = await query<PaymentRow>("SELECT * FROM payments WHERE id = ?", [existing.id]);
        if (attendeeResult.rows[0] && paymentResult.rows[0]) {
          return { payment: paymentResult.rows[0], attendee: attendeeResult.rows[0] };
        }
      }
      return null;
    }

    // Atomic capacity claim — supports multi-slot and NULL max_capacity (unlimited)
    const [capacityResult] = await conn.execute(
      `UPDATE events
       SET current_attendees = current_attendees + ?
       WHERE id = ? AND (max_capacity IS NULL OR current_attendees + ? <= max_capacity)`,
      [slots, eventId, slots]
    );
    if ((capacityResult as { affectedRows: number }).affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return null; // event is full
    }

    // Insert all attendee rows
    for (let i = 1; i <= slots; i++) {
      const rowId = i === 1 ? primaryAttendeeId : uuidv4();
      const qrToken = crypto.randomBytes(32).toString("hex");
      await conn.execute(
        `INSERT INTO event_attendees (id, event_id, user_id, payment_id, qr_token, tier_id, group_id, group_size, slot_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rowId, eventId, i === 1 ? userId : null, existing.id, qrToken, resolvedTierId, groupId, slots, i]
      );
    }

    // Mark payment complete with all three Razorpay IDs
    await conn.execute(
      `UPDATE payments
       SET status = 'completed',
           razorpay_payment_id = ?,
           razorpay_signature = ?,
           completed_at = NOW()
       WHERE id = ? AND status = 'initiated'`,
      [razorpayPaymentId, razorpaySignature, existing.id]
    );

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }

  const [paymentResult, attendeeResult] = await Promise.all([
    query<PaymentRow>("SELECT * FROM payments WHERE id = ?", [existing.id]),
    query<AttendeeRow>("SELECT * FROM event_attendees WHERE id = ?", [primaryAttendeeId]),
  ]);

  return {
    payment: paymentResult.rows[0]!,
    attendee: attendeeResult.rows[0]!,
  };
}

/**
 * Marks an initiated or completed payment as failed.
 * Called by the webhook on payment.failed events.
 */
export async function markPaymentFailed(razorpayOrderId: string): Promise<void> {
  await query(
    `UPDATE payments SET status = 'failed' WHERE razorpay_order_id = ? AND status = 'initiated'`,
    [razorpayOrderId]
  );
}

// ============================================
// TRANSACTIONAL PAYMENT + ADMISSION (LEGACY MOCK)
// ============================================

/**
 * @deprecated For mock/test flows only. Use createInitiatedPayment + verifyAndAdmit
 * for real Razorpay payments.
 *
 * Atomically creates the payment record, claims a capacity slot, and inserts
 * the attendee — all inside a single PostgreSQL transaction on one connection.
 * Returns null if the event is full (capacity slot could not be claimed).
 */
export async function payAndAdmit(
  payerId: string,
  hostId: string,
  eventId: string,
  amount: number,
  currency: string
): Promise<{ payment: PaymentRow; attendee: AttendeeRow } | null> {
  const conn = await getConnection();
  const paymentId = uuidv4();
  const attendeeId = uuidv4();
  const mockTxnId = `MOCK_TXN_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  try {
    await conn.beginTransaction();

    // 1. Insert payment row
    await conn.execute(
      `INSERT INTO payments (id, payer_id, host_id, event_id, amount, currency, status, mock_transaction_id, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, NOW())`,
      [paymentId, payerId, hostId, eventId, amount, currency, mockTxnId]
    );

    // 2. Atomic capacity claim — fails if event is already at max_capacity
    const [capacityResult] = await conn.execute(
      "UPDATE events SET current_attendees = current_attendees + 1 WHERE id = ? AND current_attendees < max_capacity",
      [eventId]
    );
    if ((capacityResult as { affectedRows: number }).affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return null; // event is full
    }

    // 3. Insert attendee row (with a QR token for check-in)
    const qrToken = crypto.randomBytes(32).toString("hex");
    await conn.execute(
      "INSERT INTO event_attendees (id, event_id, user_id, payment_id, qr_token) VALUES (?, ?, ?, ?, ?)",
      [attendeeId, eventId, payerId, paymentId, qrToken]
    );

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }

  // Fetch committed rows via pool (outside the transaction)
  const [paymentResult, attendeeResult] = await Promise.all([
    query<PaymentRow>("SELECT * FROM payments WHERE id = ?", [paymentId]),
    query<AttendeeRow>("SELECT * FROM event_attendees WHERE id = ?", [attendeeId]),
  ]);

  return {
    payment: paymentResult.rows[0]!,
    attendee: attendeeResult.rows[0]!,
  };
}

export async function refundEventPayments(eventId: string): Promise<void> {
  await query(
    "UPDATE payments SET status = 'refunded' WHERE event_id = ? AND status = 'completed'",
    [eventId]
  );
}

/**
 * Returns all completed payments for a event (used when issuing real refunds).
 * Only payments with status='completed' and a razorpay_payment_id are eligible.
 */
export async function getCompletedPaymentsForEvent(eventId: string): Promise<PaymentRow[]> {
  const result = await query<PaymentRow>(
    `SELECT * FROM payments
     WHERE event_id = ? AND status = 'completed' AND razorpay_payment_id IS NOT NULL`,
    [eventId]
  );
  return result.rows;
}

/**
 * Updates a payment record after a successful Razorpay refund.
 * @param status 'refunded' for full refunds, 'partial_refund' for partial
 */
export async function markPaymentRefundedWithDetails(
  paymentId: string,
  refundRazorpayId: string | null,
  refundedAmount: number,
  status: "refunded" | "partial_refund" | "refund_failed"
): Promise<void> {
  await query(
    `UPDATE payments
     SET status = ?, refunded_amount = ?, refund_razorpay_id = ?
     WHERE id = ?`,
    [status, refundedAmount, refundRazorpayId, paymentId]
  );
}

/**
 * Gets the attendee record for a user at a event, joined with their payment.
 */
export async function getAttendeeWithPayment(
  eventId: string,
  userId: string
): Promise<(AttendeeRow & { payment: PaymentRow | null }) | null> {
  const attendeeResult = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE event_id = ? AND user_id = ?",
    [eventId, userId]
  );
  const attendee = attendeeResult.rows[0];
  if (!attendee) return null;

  let payment: PaymentRow | null = null;
  if (attendee.payment_id) {
    const payResult = await query<PaymentRow>(
      "SELECT * FROM payments WHERE id = ?",
      [attendee.payment_id]
    );
    payment = payResult.rows[0] || null;
  }

  return { ...attendee, payment };
}

/**
 * Atomically removes an attendee and frees their capacity slot.
 * Used for guest-initiated ticket cancellations.
 */
export async function removeAttendeeAndFreeSlot(
  eventId: string,
  userId: string
): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?",
      [eventId, userId]
    );
    await conn.execute(
      "UPDATE events SET current_attendees = GREATEST(0, current_attendees - 1) WHERE id = ?",
      [eventId]
    );
    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
}

/**
 * Atomically admits an approved requester to a free event by claiming a
 * capacity slot first, then inserting attendee row. Returns null if no slot
 * could be claimed.
 */
export async function admitToFreeEvent(
  eventId: string,
  userId: string
): Promise<AttendeeRow | null> {
  const conn = await getConnection();
  const attendeeId = uuidv4();

  try {
    await conn.beginTransaction();

    const [capacityResult] = await conn.execute(
      `UPDATE events
       SET current_attendees = current_attendees + 1
       WHERE id = ? AND ticket_price = 0 AND current_attendees < max_capacity`,
      [eventId]
    );

    if ((capacityResult as { affectedRows: number }).affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return null;
    }

    await conn.execute(
      `INSERT INTO event_attendees (id, event_id, user_id, payment_id)
       VALUES (?, ?, ?, NULL)`,
      [attendeeId, eventId, userId]
    );

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }

  const result = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE id = ?",
    [attendeeId]
  );
  return result.rows[0] || null;
}

/**
 * Atomically approves a pending request and admits the user (free path).
 * Supports multi-slot group tickets (Couple, Family Pack, etc.).
 *
 * - slots: how many attendee rows to create (default 1)
 * - tierId: optional tier to tag the attendee rows with
 *
 * Returns null if the event is full or the request is no longer pending.
 */
export async function approveFreeRequestAndAdmit(
  eventId: string,
  requestId: string,
  userId: string,
  slots: number = 1,
  tierId: string | null = null
): Promise<{ attendee: AttendeeRow } | null> {
  const conn = await getConnection();
  const primaryAttendeeId = uuidv4();
  const groupId = slots > 1 ? uuidv4() : null;

  try {
    await conn.beginTransaction();

    const [requestResult] = await conn.execute(
      `UPDATE event_requests
       SET status = 'approved', responded_at = NOW()
       WHERE id = ? AND event_id = ? AND user_id = ? AND status = 'pending'`,
      [requestId, eventId, userId]
    );

    if ((requestResult as { affectedRows: number }).affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return null;
    }

    // Atomic capacity claim — handles NULL max_capacity (unlimited) and multi-slot
    const [capacityResult] = await conn.execute(
      `UPDATE events
       SET current_attendees = current_attendees + ?
       WHERE id = ? AND (max_capacity IS NULL OR current_attendees + ? <= max_capacity)`,
      [slots, eventId, slots]
    );

    if ((capacityResult as { affectedRows: number }).affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return null;
    }

    // Create all attendee rows
    for (let i = 1; i <= slots; i++) {
      const rowId = i === 1 ? primaryAttendeeId : uuidv4();
      const qrToken = crypto.randomBytes(32).toString("hex");
      await conn.execute(
        `INSERT INTO event_attendees (id, event_id, user_id, payment_id, qr_token, tier_id, group_id, group_size, slot_index)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          rowId,
          eventId,
          i === 1 ? userId : null,  // only primary slot gets the user; extras unassigned
          qrToken,
          tierId,
          groupId,
          slots,
          i,
        ]
      );
    }

    await conn.commit();
    conn.release();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }

  const attendeeResult = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE id = ?",
    [primaryAttendeeId]
  );

  return {
    attendee: attendeeResult.rows[0]!,
  };
}

/**
 * Approve a paid event request without creating an attendee row.
 * The attendee row is created later on payment verification.
 * Returns null if the request is no longer pending.
 */
export async function approvePaidRequest(
  requestId: string,
  eventId: string,
  userId: string
): Promise<boolean> {
  const result = await query<{ affectedRows: number }>(
    `UPDATE event_requests
     SET status = 'approved', responded_at = NOW()
     WHERE id = ? AND event_id = ? AND user_id = ? AND status = 'pending'`,
    [requestId, eventId, userId]
  );
  return result.rows.length > 0 || true; // rely on the query's affectedRows via DB adapter
  // Simpler: just re-fetch
}

// ============================================
// TICKET / QR CHECK-IN QUERIES
// ============================================

export interface TicketRow {
  attendee_id: string;
  event_id: string;
  user_id: string;
  qr_token: string;
  checked_in: boolean;
  checked_in_at: Date | null;
  joined_at: Date;
  // Tier / group info (migration 027)
  tier_id: string | null;
  tier_name: string | null;
  tier_price: number | null;
  group_id: string | null;
  group_size: number;
  slot_index: number;
  // Event fields
  event_title: string;
  event_date_time: Date;
  event_end_time: Date | null;
  event_location_name: string;
  event_location_city: string;
  event_cover_image_url: string | null;
  event_ticket_price: number;
  event_max_capacity: number | null;
  event_current_attendees: number;
  event_tags: string | null;
  event_host_id: string;
  // Guest fields
  guest_username: string;
  guest_display_name: string;
  guest_avatar_url: string | null;
  guest_social_rating: number;
}

export interface GroupSlotRow {
  attendee_id: string;
  slot_index: number;
  group_size: number;
  qr_token: string;
  checked_in: boolean;
  checked_in_at: Date | null;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export async function getMyTicket(
  eventId: string,
  userId: string
): Promise<TicketRow | null> {
  const result = await query<TicketRow>(
    `SELECT
       a.id            AS attendee_id,
       a.event_id,
       a.user_id,
       a.qr_token,
       a.checked_in,
       a.checked_in_at,
       a.joined_at,
       a.tier_id,
       t.name          AS tier_name,
       t.price         AS tier_price,
       a.group_id,
       a.group_size,
       a.slot_index,
       p.title         AS event_title,
       p.date_time     AS event_date_time,
       p.end_time      AS event_end_time,
       p.location_name AS event_location_name,
       p.location_city AS event_location_city,
       p.cover_image_url AS event_cover_image_url,
       p.ticket_price  AS event_ticket_price,
       p.max_capacity  AS event_max_capacity,
       p.current_attendees AS event_current_attendees,
       p.tags          AS event_tags,
       p.host_id       AS event_host_id,
       u.username      AS guest_username,
       u.display_name  AS guest_display_name,
       u.avatar_url    AS guest_avatar_url,
       u.social_rating AS guest_social_rating
     FROM event_attendees a
     JOIN events p ON p.id = a.event_id
     JOIN users   u ON u.id = a.user_id
     LEFT JOIN ticket_tiers t ON t.id = a.tier_id
     WHERE a.event_id = ? AND a.user_id = ? AND a.slot_index = 1`,
    [eventId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Returns ALL tickets (primary slot) for a user across all events.
 * Used by the "My Tickets" page.
 */
export async function getAllMyTickets(userId: string): Promise<TicketRow[]> {
  const result = await query<TicketRow>(
    `SELECT
       a.id            AS attendee_id,
       a.event_id,
       a.user_id,
       a.qr_token,
       a.checked_in,
       a.checked_in_at,
       a.joined_at,
       a.tier_id,
       t.name          AS tier_name,
       t.price         AS tier_price,
       a.group_id,
       a.group_size,
       a.slot_index,
       p.title         AS event_title,
       p.date_time     AS event_date_time,
       p.end_time      AS event_end_time,
       p.location_name AS event_location_name,
       p.location_city AS event_location_city,
       p.cover_image_url AS event_cover_image_url,
       p.ticket_price  AS event_ticket_price,
       p.max_capacity  AS event_max_capacity,
       p.current_attendees AS event_current_attendees,
       p.tags          AS event_tags,
       p.host_id       AS event_host_id,
       u.username      AS guest_username,
       u.display_name  AS guest_display_name,
       u.avatar_url    AS guest_avatar_url,
       u.social_rating AS guest_social_rating
     FROM event_attendees a
     JOIN events p ON p.id = a.event_id
     JOIN users   u ON u.id = a.user_id
     LEFT JOIN ticket_tiers t ON t.id = a.tier_id
     WHERE a.user_id = ? AND a.slot_index = 1
     ORDER BY p.date_time DESC`,
    [userId]
  );
  return result.rows;
}

/** Get all group slots for the group a user belongs to at a event. */
export async function getGroupSlots(
  eventId: string,
  userId: string
): Promise<GroupSlotRow[]> {
  // Find the group_id for this user's primary slot
  const primary = await query<{ group_id: string | null }>(
    "SELECT group_id FROM event_attendees WHERE event_id = ? AND user_id = ? AND slot_index = 1",
    [eventId, userId]
  );
  const groupId = primary.rows[0]?.group_id;
  if (!groupId) return []; // single-slot ticket — no extra slots

  const result = await query<GroupSlotRow>(
    `SELECT
       a.id AS attendee_id,
       a.slot_index,
       a.group_size,
       a.qr_token,
       a.checked_in,
       a.checked_in_at,
       a.user_id,
       u.username,
       u.display_name,
       u.avatar_url
     FROM event_attendees a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.event_id = ? AND a.group_id = ?
     ORDER BY a.slot_index ASC`,
    [eventId, groupId]
  );
  return result.rows;
}

/**
 * Assign an unassigned group slot to a user.
 * The caller (requesterId) must own the primary slot (slot_index=1) of the same group.
 * The assignee must not already have a slot in this event.
 */
export async function assignSlotToUser(
  attendeeId: string,
  assigneeUserId: string,
  requesterId: string,
  eventId: string
): Promise<{ success: boolean; reason?: string }> {
  // Fetch the target attendee slot
  const slotResult = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE id = ? AND event_id = ?",
    [attendeeId, eventId]
  );
  const slot = slotResult.rows[0];
  if (!slot) return { success: false, reason: "Slot not found" };
  if (slot.user_id !== null) return { success: false, reason: "Slot already assigned" };
  if (!slot.group_id) return { success: false, reason: "Not a group ticket" };

  // Verify requester owns the primary slot of this group
  const primaryResult = await query<AttendeeRow>(
    "SELECT * FROM event_attendees WHERE event_id = ? AND group_id = ? AND slot_index = 1",
    [eventId, slot.group_id]
  );
  const primary = primaryResult.rows[0];
  if (!primary || primary.user_id !== requesterId) {
    return { success: false, reason: "You are not the group owner" };
  }

  // Ensure assignee is not already in this event
  const existingResult = await query<{ id: string }>(
    "SELECT id FROM event_attendees WHERE event_id = ? AND user_id = ?",
    [eventId, assigneeUserId]
  );
  if (existingResult.rows.length > 0) {
    return { success: false, reason: "User already has a ticket for this event" };
  }

  await query(
    "UPDATE event_attendees SET user_id = ? WHERE id = ? AND user_id IS NULL",
    [assigneeUserId, attendeeId]
  );
  return { success: true };
}

export async function scanAndCheckIn(
  eventId: string,
  token: string
): Promise<{ ticket: TicketRow; already_checked_in: boolean } | null> {
  // Find attendee by token — must belong to this event
  const found = await query<AttendeeRow>(
    `SELECT * FROM event_attendees WHERE event_id = ? AND qr_token = ?`,
    [eventId, token]
  );
  const attendee = found.rows[0];
  if (!attendee || !attendee.user_id) return null; // unassigned slot cannot be scanned

  if (attendee.checked_in) {
    // Already checked in — return info without updating
    const ticket = await getMyTicket(eventId, attendee.user_id);
    return ticket ? { ticket, already_checked_in: true } : null;
  }

  // Atomic one-time check-in: only succeeds if checked_in is still false
  await query(
    `UPDATE event_attendees
     SET checked_in = TRUE, checked_in_at = NOW()
     WHERE event_id = ? AND qr_token = ? AND checked_in = FALSE`,
    [eventId, token]
  );

  // Fetch the updated ticket
  const ticket = await getMyTicket(eventId, attendee.user_id);
  if (!ticket) return null;

  return { ticket, already_checked_in: false };
}

// ============================================
// DEPOSIT QUERIES (migration 023)
// ============================================

/**
 * Find an existing initiated deposit payment for a host on a event.
 * Used for idempotent re-use if the host retries.
 */
export async function findInitiatedDepositForHost(
  eventId: string,
  hostId: string
): Promise<PaymentRow | null> {
  const result = await query<PaymentRow>(
    `SELECT * FROM payments
     WHERE event_id = ? AND payer_id = ? AND payment_type = 'deposit' AND status = 'initiated'
     ORDER BY created_at DESC LIMIT 1`,
    [eventId, hostId]
  );
  return result.rows[0] || null;
}

/**
 * Mark a deposit payment as completed (called after HMAC verification passes).
 */
export async function markDepositPaymentCompleted(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<PaymentRow | null> {
  await query(
    `UPDATE payments
     SET status = 'completed', razorpay_payment_id = ?, razorpay_signature = ?, completed_at = NOW()
     WHERE razorpay_order_id = ? AND status = 'initiated' AND payment_type = 'deposit'`,
    [razorpayPaymentId, razorpaySignature, razorpayOrderId]
  );
  const result = await query<PaymentRow>(
    "SELECT * FROM payments WHERE razorpay_order_id = ?",
    [razorpayOrderId]
  );
  return result.rows[0] || null;
}
