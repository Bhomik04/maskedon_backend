import { v4 as uuidv4 } from "uuid";
import { query } from "./connection";

export interface RefundJobRow {
  id: string;
  payment_id: string;
  refund_amount: number;
  status: "pending" | "processing" | "retrying" | "succeeded" | "failed";
  attempt_count: number;
  last_error: string | null;
  provider_refund_id: string | null;
  next_retry_at: Date | null;
  created_at: Date;
  updated_at: Date;
  payer_username?: string;
  host_username?: string;
  event_title?: string;
  payment_status?: string;
  payment_amount?: number;
  payment_currency?: string;
  payment_razorpay_payment_id?: string | null;
  payment_razorpay_order_id?: string | null;
}

export interface HostPayoutRow {
  id: string;
  event_id: string;
  host_id: string;
  gross_amount: number;
  platform_fee: number;
  net_amount: number;
  status: "pending" | "processing" | "paid" | "failed" | "retrying";
  provider_transfer_id: string | null;
  failure_reason: string | null;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: Date | null;
  settled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  event_title?: string;
  host_username?: string;
  host_display_name?: string;
}

export interface HostPayoutItemRow {
  id: string;
  host_payout_id: string;
  payment_id: string;
  amount: number;
  platform_fee: number;
  net_amount: number;
  created_at: Date;
}

export interface HostPayoutSummary {
  total: number;
  pending: number;
  processing: number;
  paid: number;
  failed: number;
  retrying: number;
  recent_payouts: HostPayoutRow[];
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function buildRetryAt(attemptCount: number): Date {
  const cappedAttempt = Math.max(0, attemptCount);
  const delayMs = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** cappedAttempt));
  return new Date(Date.now() + delayMs);
}

export async function enqueueRefundJob(paymentId: string, refundAmount: number): Promise<RefundJobRow> {
  const id = uuidv4();
  const result = await query<RefundJobRow>(
    `INSERT INTO refund_jobs (
       id, payment_id, refund_amount, status, attempt_count, last_error, provider_refund_id, next_retry_at
     ) VALUES (?, ?, ?, 'pending', 0, NULL, NULL, NULL)
     ON CONFLICT (payment_id) DO UPDATE SET
       refund_amount = EXCLUDED.refund_amount,
       status = CASE
         WHEN refund_jobs.status IN ('succeeded', 'processing') THEN refund_jobs.status
         ELSE 'pending'
       END,
       last_error = NULL,
       provider_refund_id = NULL,
       next_retry_at = NULL,
       updated_at = NOW()
     RETURNING *`,
    [id, paymentId, refundAmount]
  );
  return result.rows[0]!;
}

export async function findDueRefundJobs(limit = 10): Promise<RefundJobRow[]> {
  const result = await query<RefundJobRow>(
    `SELECT rj.*, pay.status AS payment_status, pay.amount AS payment_amount, pay.currency AS payment_currency,
            pay.razorpay_payment_id AS payment_razorpay_payment_id,
            pay.razorpay_order_id AS payment_razorpay_order_id,
            payer.username AS payer_username, host.username AS host_username, p.title AS event_title
     FROM refund_jobs rj
     JOIN payments pay ON pay.id = rj.payment_id
     JOIN users payer ON payer.id = pay.payer_id
     JOIN users host ON host.id = pay.host_id
     JOIN events p ON p.id = pay.event_id
     WHERE rj.status IN ('pending', 'retrying')
       AND (rj.next_retry_at IS NULL OR rj.next_retry_at <= NOW())
     ORDER BY rj.created_at ASC
     LIMIT ?`,
    [limit]
  );
  return result.rows;
}

export async function markRefundJobProcessing(jobId: string): Promise<void> {
  await query(
    `UPDATE refund_jobs
     SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = ?`,
    [jobId]
  );
}

export async function markRefundJobRetry(jobId: string, lastError: string, nextRetryAt: Date): Promise<void> {
  await query(
    `UPDATE refund_jobs
     SET status = 'retrying', last_error = ?, next_retry_at = ?, updated_at = NOW()
     WHERE id = ?`,
    [lastError.substring(0, 1000), nextRetryAt, jobId]
  );
}

export async function markRefundJobFailed(jobId: string, lastError: string): Promise<void> {
  await query(
    `UPDATE refund_jobs
     SET status = 'failed', last_error = ?, next_retry_at = NULL, updated_at = NOW()
     WHERE id = ?`,
    [lastError.substring(0, 1000), jobId]
  );
}

export async function markRefundJobSucceeded(jobId: string, providerRefundId: string | null): Promise<void> {
  await query(
    `UPDATE refund_jobs
     SET status = 'succeeded', provider_refund_id = ?, last_error = NULL, next_retry_at = NULL, updated_at = NOW()
     WHERE id = ?`,
    [providerRefundId, jobId]
  );
}

export async function listRefundJobs(limit = 50, offset = 0): Promise<{ jobs: RefundJobRow[]; total: number }> {
  const totalResult = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM refund_jobs`);
  const result = await query<RefundJobRow>(
    `SELECT rj.*, pay.status AS payment_status, pay.amount AS payment_amount, pay.currency AS payment_currency,
            pay.razorpay_payment_id AS payment_razorpay_payment_id,
            pay.razorpay_order_id AS payment_razorpay_order_id,
            payer.username AS payer_username, host.username AS host_username, p.title AS event_title
     FROM refund_jobs rj
     JOIN payments pay ON pay.id = rj.payment_id
     JOIN users payer ON payer.id = pay.payer_id
     JOIN users host ON host.id = pay.host_id
     JOIN events p ON p.id = pay.event_id
     ORDER BY rj.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  return {
    jobs: result.rows,
    total: Number(totalResult.rows[0]?.total ?? 0),
  };
}

export async function listRefundJobsByStatus(status: string, limit = 50, offset = 0): Promise<{ jobs: RefundJobRow[]; total: number }> {
  const totalResult = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM refund_jobs WHERE status = ?`, [status]);
  const result = await query<RefundJobRow>(
    `SELECT rj.*, pay.status AS payment_status, pay.amount AS payment_amount, pay.currency AS payment_currency,
            pay.razorpay_payment_id AS payment_razorpay_payment_id,
            pay.razorpay_order_id AS payment_razorpay_order_id,
            payer.username AS payer_username, host.username AS host_username, p.title AS event_title
     FROM refund_jobs rj
     JOIN payments pay ON pay.id = rj.payment_id
     JOIN users payer ON payer.id = pay.payer_id
     JOIN users host ON host.id = pay.host_id
     JOIN events p ON p.id = pay.event_id
     WHERE rj.status = ?
     ORDER BY rj.created_at DESC
     LIMIT ? OFFSET ?`,
    [status, limit, offset]
  );

  return {
    jobs: result.rows,
    total: Number(totalResult.rows[0]?.total ?? 0),
  };
}

export async function retryRefundJob(jobId: string): Promise<RefundJobRow | null> {
  const result = await query<RefundJobRow>(
    `UPDATE refund_jobs
     SET status = 'pending', last_error = NULL, next_retry_at = NULL, updated_at = NOW()
     WHERE id = ?
     RETURNING *`,
    [jobId]
  );
  return result.rows[0] ?? null;
}

export async function getCompletedEventPayments(eventId: string): Promise<Array<{ id: string; amount: number; platform_fee: number }>> {
  const result = await query<{ id: string; amount: number; platform_fee: number }>(
    `SELECT id, amount, platform_fee
     FROM payments
     WHERE event_id = ? AND status = 'completed'`,
    [eventId]
  );
  return result.rows;
}

export async function enqueueHostPayoutForEvent(eventId: string): Promise<HostPayoutRow | null> {
  const existing = await query<HostPayoutRow>(`SELECT * FROM host_payouts WHERE event_id = ?`, [eventId]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const eventResult = await query<{ host_id: string; title: string }>(
    `SELECT host_id, title FROM events WHERE id = ? AND deleted_at IS NULL`,
    [eventId]
  );
  const event = eventResult.rows[0];
  if (!event) return null;

  const paymentsResult = await query<{ id: string; amount: number; platform_fee: number; payment_type: string }>(
    `SELECT id, amount, platform_fee, payment_type
     FROM payments
     WHERE event_id = ? AND status = 'completed'`,
    [eventId]
  );
  const payments = paymentsResult.rows;
  if (payments.length === 0) {
    return null;
  }

  // 1. Fetch Host Commission Rule (Override vs Global Setting)
  const hostResult = await query<{ commission_override_rate: number | null }>(
    `SELECT commission_override_rate FROM users WHERE id = ?`,
    [event.host_id]
  );
  const hostOverride = hostResult.rows[0]?.commission_override_rate;

  let commPercent = 0.0;
  if (hostOverride !== null && hostOverride !== undefined) {
    commPercent = Number(hostOverride);
  } else {
    const settingsEnabled = await query<{ value: string }>(
      `SELECT value FROM platform_settings WHERE key = 'commission_enabled'`
    );
    const settingsRate = await query<{ value: string }>(
      `SELECT value FROM platform_settings WHERE key = 'commission_rate_percent'`
    );
    if (settingsEnabled.rows[0]?.value === "true") {
      commPercent = parseFloat(settingsRate.rows[0]?.value || "12.0");
    }
  }

  // 2. Separate tickets and deposits
  const tickets = payments.filter((p) => p.payment_type !== "deposit");
  const deposits = payments.filter((p) => p.payment_type === "deposit");

  // Gross tickets base (excluding user-facing platform fee)
  let grossTicketsBase = 0;
  for (const t of tickets) {
    grossTicketsBase += (t.amount - t.platform_fee);
  }

  // Commission = Rate * Gross Tickets Base
  const commissionAmount = Math.round(grossTicketsBase * (commPercent / 100));

  // Deposit returned
  const depositAmountReturned = deposits.reduce((sum, d) => sum + Number(d.amount || 0), 0);

  // Net host payout = (Gross Tickets - Commission) + Deposit
  const netAmount = (grossTicketsBase - commissionAmount) + depositAmountReturned;
  const grossAmount = grossTicketsBase + depositAmountReturned;
  const platformFee = commissionAmount;

  const payoutId = uuidv4();
  const payout = await query<HostPayoutRow>(
    `INSERT INTO host_payouts (
       id, event_id, host_id, gross_amount, platform_fee, net_amount, status, provider_transfer_id, failure_reason, attempt_count, last_error, next_retry_at, settled_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, NULL, NULL)
     RETURNING *`,
    [payoutId, eventId, event.host_id, grossAmount, platformFee, netAmount]
  );

  for (const payment of payments) {
    let paymentFee = 0;
    let paymentNet = payment.amount;

    if (payment.payment_type !== "deposit") {
      const ticketBase = payment.amount - payment.platform_fee;
      paymentFee = Math.round(ticketBase * (commPercent / 100));
      paymentNet = ticketBase - paymentFee;
    }

    await query(
      `INSERT INTO host_payout_items (id, host_payout_id, payment_id, amount, platform_fee, net_amount)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (host_payout_id, payment_id) DO NOTHING`,
      [uuidv4(), payoutId, payment.id, payment.amount, paymentFee, paymentNet]
    );
  }

  return payout.rows[0] ?? null;
}

export async function findDueHostPayouts(limit = 10): Promise<HostPayoutRow[]> {
  const result = await query<HostPayoutRow>(
    `SELECT hp.*, p.title AS event_title, u.username AS host_username, u.display_name AS host_display_name
     FROM host_payouts hp
     JOIN events p ON p.id = hp.event_id
     JOIN users u ON u.id = hp.host_id
     WHERE hp.status IN ('pending', 'retrying')
       AND (hp.next_retry_at IS NULL OR hp.next_retry_at <= NOW())
     ORDER BY hp.created_at ASC
     LIMIT ?`,
    [limit]
  );
  return result.rows;
}

export async function markHostPayoutProcessing(payoutId: string): Promise<void> {
  await query(
    `UPDATE host_payouts
     SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = ?`,
    [payoutId]
  );
}

export async function markHostPayoutRetry(payoutId: string, lastError: string, nextRetryAt: Date): Promise<void> {
  await query(
    `UPDATE host_payouts
     SET status = 'retrying', last_error = ?, next_retry_at = ?, updated_at = NOW()
     WHERE id = ?`,
    [lastError.substring(0, 1000), nextRetryAt, payoutId]
  );
}

export async function markHostPayoutFailed(payoutId: string, lastError: string): Promise<void> {
  await query(
    `UPDATE host_payouts
     SET status = 'failed', failure_reason = ?, last_error = ?, next_retry_at = NULL, updated_at = NOW()
     WHERE id = ?`,
    [lastError.substring(0, 1000), lastError.substring(0, 1000), payoutId]
  );
}

export async function markHostPayoutPaid(payoutId: string, providerTransferId: string): Promise<void> {
  await query(
    `UPDATE host_payouts
     SET status = 'paid', provider_transfer_id = ?, failure_reason = NULL, last_error = NULL, next_retry_at = NULL, settled_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [providerTransferId, payoutId]
  );
}

export async function listHostPayouts(limit = 50, offset = 0): Promise<{ payouts: HostPayoutRow[]; total: number }> {
  const totalResult = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM host_payouts`);
  const result = await query<HostPayoutRow>(
    `SELECT hp.*, p.title AS event_title, u.username AS host_username, u.display_name AS host_display_name
     FROM host_payouts hp
     JOIN events p ON p.id = hp.event_id
     JOIN users u ON u.id = hp.host_id
     ORDER BY hp.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return {
    payouts: result.rows,
    total: Number(totalResult.rows[0]?.total ?? 0),
  };
}

export async function listHostPayoutsForHost(hostId: string, limit = 50, offset = 0): Promise<{ payouts: HostPayoutRow[]; total: number }> {
  const totalResult = await query<{ total: number }>(`SELECT COUNT(*) AS total FROM host_payouts WHERE host_id = ?`, [hostId]);
  const result = await query<HostPayoutRow>(
    `SELECT hp.*, p.title AS event_title, u.username AS host_username, u.display_name AS host_display_name
     FROM host_payouts hp
     JOIN events p ON p.id = hp.event_id
     JOIN users u ON u.id = hp.host_id
     WHERE hp.host_id = ?
     ORDER BY hp.created_at DESC
     LIMIT ? OFFSET ?`,
    [hostId, limit, offset]
  );
  return {
    payouts: result.rows,
    total: Number(totalResult.rows[0]?.total ?? 0),
  };
}

export async function getHostPayoutSummary(hostId: string): Promise<HostPayoutSummary> {
  const totals = await query<{ total: number; pending: number; processing: number; paid: number; failed: number; retrying: number }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'processing') AS processing,
       COUNT(*) FILTER (WHERE status = 'paid') AS paid,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE status = 'retrying') AS retrying
     FROM host_payouts
     WHERE host_id = ?`,
    [hostId]
  );

  const recent = await query<HostPayoutRow>(
    `SELECT hp.*, p.title AS event_title, u.username AS host_username, u.display_name AS host_display_name
     FROM host_payouts hp
     JOIN events p ON p.id = hp.event_id
     JOIN users u ON u.id = hp.host_id
     WHERE hp.host_id = ?
     ORDER BY hp.created_at DESC
     LIMIT 5`,
    [hostId]
  );

  const row = totals.rows[0] ?? { total: 0, pending: 0, processing: 0, paid: 0, failed: 0, retrying: 0 };
  return {
    total: Number(row.total ?? 0),
    pending: Number(row.pending ?? 0),
    processing: Number(row.processing ?? 0),
    paid: Number(row.paid ?? 0),
    failed: Number(row.failed ?? 0),
    retrying: Number(row.retrying ?? 0),
    recent_payouts: recent.rows,
  };
}

export async function getCompletedEventIdsWithoutPayouts(limit = 25): Promise<Array<{ id: string; host_id: string }>> {
  const result = await query<{ id: string; host_id: string }>(
    `SELECT p.id, p.host_id
     FROM events p
     WHERE p.deleted_at IS NULL
       AND p.end_time IS NOT NULL
       AND p.end_time <= NOW() - INTERVAL '7 days'
       AND p.status NOT IN ('cancelled', 'archived')
       AND NOT EXISTS (
         SELECT 1 FROM host_payouts hp WHERE hp.event_id = p.id
       )
     ORDER BY p.end_time ASC
     LIMIT ?`,
    [limit]
  );
  return result.rows;
}

export async function getPendingRefundJobCount(): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM refund_jobs WHERE status IN ('pending', 'retrying')`
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function getPendingHostPayoutCount(): Promise<number> {
  const result = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM host_payouts WHERE status IN ('pending', 'retrying')`
  );
  return Number(result.rows[0]?.total ?? 0);
}
