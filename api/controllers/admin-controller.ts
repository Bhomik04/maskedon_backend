import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { query } from "../../dblayer/connection";
import {
  listRefundJobs as fetchRefundJobs,
  listRefundJobsByStatus as fetchRefundJobsByStatus,
  listHostPayouts as fetchHostPayouts,
  retryRefundJob,
  enqueueRefundJob,
  markHostPayoutProcessing,
  markHostPayoutPaid,
  markHostPayoutFailed,
  enqueueHostPayoutForEvent,
} from "../../dblayer/financial-ops";
import { executeHostPayoutTransfer } from "../lib/financial-workers";
import { listHostVerifications, reviewHostVerification } from "../../dblayer/verification-queries";
import { getAllPushTokens } from "../../dblayer/push-token-queries";
import { sendPushToToken } from "../lib/firebase";
import { calculateEventStatus, syncStaleEventStatuses } from "../../dblayer/event-queries";
import { logger } from "../lib/logger";

// ─────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────

export async function getStats(_req: Request, res: Response) {
  // Sync stale event statuses before reading stats
  void syncStaleEventStatuses();

  const [users, events, reports, bugReports, payments, photos] = await Promise.all([
    query<{ total: number; active: number; deleted: number }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE deleted_at IS NULL) AS active,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
       FROM users`
    ),
    query<{ total: number; upcoming: number; ongoing: number; completed: number; cancelled: number }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'upcoming') AS upcoming,
         COUNT(*) FILTER (WHERE status = 'ongoing') AS ongoing,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
       FROM events WHERE deleted_at IS NULL`
    ),
    query<{ total: number; open: number }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'open') AS open FROM reports`
    ),
    query<{ total: number; open: number }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'open') AS open FROM bug_reports`
    ),
    query<{ total: number; completed: number; refunded: number; revenue: number }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'refunded') AS refunded,
         COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) AS revenue
       FROM payments`
    ),
    query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM photos WHERE deleted_at IS NULL`
    ),
  ]);

  res.json({
    success: true,
    data: {
      users: users.rows[0],
      events: events.rows[0],
      reports: reports.rows[0],
      bugReports: bugReports.rows[0],
      payments: payments.rows[0],
      photos: photos.rows[0],
    },
  });
}

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

export async function listUsers(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || "").trim().substring(0, 100);
  const showDeleted = req.query.deleted === "true";

  const params: unknown[] = [];
  let whereClause = showDeleted ? "" : "WHERE deleted_at IS NULL";

  if (search) {
    const idx = params.push(`%${search}%`);
    const nextIdx = params.push(`%${search}%`);
    const clause = `(username ILIKE $${idx} OR display_name ILIKE $${nextIdx} OR email ILIKE $${params.push(`%${search}%`)})`;
    whereClause = whereClause ? `${whereClause} AND ${clause}` : `WHERE ${clause}`;
  }

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM users ${whereClause}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const limitIdx = dataParams.length - 1;
  const offsetIdx = dataParams.length;

  const result = await query(
    `SELECT id, email, username, display_name, bio, avatar_url,
            social_rating, total_ratings, events_hosted, events_attended,
            created_at, deleted_at
     FROM users ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  res.json({
    success: true,
    data: {
      users: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function getUser(req: Request, res: Response) {
  const { id } = req.params;
  const result = await query(
    `SELECT id, email, username, display_name, bio, avatar_url,
            social_rating, total_ratings, events_hosted, events_attended,
            created_at, updated_at, deleted_at
     FROM users WHERE id = ?`,
    [id]
  );
  if (!result.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
    return;
  }
  res.json({ success: true, data: { user: result.rows[0] } });
}

export async function updateUser(req: Request, res: Response) {
  const { id } = req.params;
  const { display_name, bio, banned } = req.body as {
    display_name?: string;
    bio?: string;
    banned?: boolean;
  };

  const setClauses: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];

  if (display_name !== undefined) {
    params.push(display_name.substring(0, 100));
    setClauses.push(`display_name = $${params.length}`);
  }
  if (bio !== undefined) {
    params.push(bio.substring(0, 500));
    setClauses.push(`bio = $${params.length}`);
  }
  if (banned === true) {
    setClauses.push(`deleted_at = NOW()`);
  } else if (banned === false) {
    setClauses.push(`deleted_at = NULL`);
  }

  if (setClauses.length === 1) {
    res.status(400).json({ success: false, error: { code: "NO_CHANGES", message: "No fields to update" } });
    return;
  }

  params.push(id);
  const result = await query(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${params.length} RETURNING id, username, display_name, bio, deleted_at`,
    params
  );

  if (!result.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
    return;
  }

  res.json({ success: true, data: { user: result.rows[0] } });
}

export async function deleteUser(req: Request, res: Response) {
  const { id } = req.params;
  await query(`UPDATE users SET deleted_at = NOW() WHERE id = ?`, [id]);
  res.json({ success: true, data: { message: "User soft-deleted" } });
}

// ─────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────

export async function listEvents(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();
  const search = String(req.query.search || "").trim().substring(0, 100);

  const params: unknown[] = [];
  const conditions: string[] = ["p.deleted_at IS NULL"];

  if (status && ["upcoming", "ongoing", "completed", "cancelled", "archived"].includes(status)) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    params.push(`%${search}%`);
    conditions.push(`(p.title ILIKE $${idx} OR p.location_city ILIKE $${params.length})`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM events p ${where}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const limitIdx = dataParams.length - 1;
  const offsetIdx = dataParams.length;

  // Sync stale statuses in the background so DB stays current
  void syncStaleEventStatuses();

  const result = await query(
    `SELECT p.id, p.title, p.location_name, p.location_city, p.date_time, p.end_time,
            p.max_capacity, p.current_attendees, p.ticket_price, p.currency,
            p.status, p.cover_image_url, p.tags, p.min_rating, p.created_at, p.deleted_at,
            u.username AS host_username, u.display_name AS host_display_name
     FROM events p
     JOIN users u ON u.id = p.host_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  res.json({
    success: true,
    data: {
      events: result.rows.map((p: any) => ({
        ...p,
        status: calculateEventStatus(p),
      })),
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function updateEvent(req: Request, res: Response) {
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  const validStatuses = ["upcoming", "ongoing", "completed", "cancelled", "archived"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Invalid event status" } });
    return;
  }

  const result = await query(
    `UPDATE events SET status = ?, updated_at = NOW() WHERE id = ? RETURNING id, title, status`,
    [status, id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  res.json({ success: true, data: { event: result.rows[0] } });
}

export async function deleteEvent(req: Request, res: Response) {
  const { id } = req.params;
  await query(`UPDATE events SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?`, [id]);
  res.json({ success: true, data: { message: "Event soft-deleted" } });
}

// ─────────────────────────────────────────────
// PHOTOS
// ─────────────────────────────────────────────

export async function listPhotos(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM photos WHERE deleted_at IS NULL`
  );

  const result = await query(
    `SELECT ph.id, ph.image_url, ph.thumbnail_url, ph.caption, ph.like_count, ph.view_count,
            ph.created_at, ph.event_id,
            u.username, u.display_name,
            p.title AS event_title
     FROM photos ph
     JOIN users u ON u.id = ph.user_id
     LEFT JOIN events p ON p.id = ph.event_id
     WHERE ph.deleted_at IS NULL
     ORDER BY ph.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  res.json({
    success: true,
    data: {
      photos: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function deletePhoto(req: Request, res: Response) {
  const { id } = req.params;
  await query(`UPDATE photos SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?`, [id]);
  res.json({ success: true, data: { message: "Photo soft-deleted" } });
}

// ─────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────

export async function listReports(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();

  const params: unknown[] = [];
  let where = "";

  if (status && ["open", "reviewed", "resolved", "dismissed"].includes(status)) {
    params.push(status);
    where = `WHERE r.status = $${params.length}`;
  }

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM reports r ${where}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const limitIdx = dataParams.length - 1;
  const offsetIdx = dataParams.length;

  const result = await query(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.description, r.status, r.created_at,
            u.username AS reporter_username, u.display_name AS reporter_display_name
     FROM reports r
     JOIN users u ON u.id = r.reporter_id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  res.json({
    success: true,
    data: {
      reports: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function updateReport(req: Request, res: Response) {
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  const validStatuses = ["open", "reviewed", "resolved", "dismissed"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Invalid report status" } });
    return;
  }

  const result = await query(
    `UPDATE reports SET status = ? WHERE id = ? RETURNING id, status`,
    [status, id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Report not found" } });
    return;
  }

  res.json({ success: true, data: { report: result.rows[0] } });
}

// ─────────────────────────────────────────────
// BUG REPORTS
// ─────────────────────────────────────────────

export async function listBugReports(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();
  const severity = String(req.query.severity || "").trim();

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (status) {
    params.push(status);
    conditions.push(`br.status = $${params.length}`);
  }
  if (severity && ["low", "medium", "high", "critical"].includes(severity)) {
    params.push(severity);
    conditions.push(`br.severity = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM bug_reports br ${where}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const limitIdx = dataParams.length - 1;
  const offsetIdx = dataParams.length;

  const result = await query(
    `SELECT br.id, br.category, br.severity, br.affected_feature, br.steps_to_reproduce,
            br.expected_behavior, br.actual_behavior, br.screenshot_urls,
            br.status, br.created_at,
            u.username AS reporter_username, u.display_name AS reporter_display_name
     FROM bug_reports br
     LEFT JOIN users u ON u.id = br.reporter_id
     ${where}
     ORDER BY
       CASE br.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       br.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  res.json({
    success: true,
    data: {
      bugReports: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function updateBugReport(req: Request, res: Response) {
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  const validStatuses = ["open", "in_progress", "resolved", "closed", "wont_fix"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Invalid bug report status" } });
    return;
  }

  const result = await query(
    `UPDATE bug_reports SET status = ? WHERE id = ? RETURNING id, status`,
    [status, id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Bug report not found" } });
    return;
  }

  res.json({ success: true, data: { bugReport: result.rows[0] } });
}

// ─────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────

export async function listPayments(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();

  const params: unknown[] = [];
  let where = "";

  if (status && ["pending", "completed", "refunded"].includes(status)) {
    params.push(status);
    where = `WHERE pay.status = $${params.length}`;
  }

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM payments pay ${where}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const limitIdx = dataParams.length - 1;
  const offsetIdx = dataParams.length;

  const result = await query(
    `SELECT pay.id, pay.amount, pay.currency, pay.status,
            pay.mock_transaction_id, pay.created_at, pay.completed_at,
            payer.username AS payer_username, payer.display_name AS payer_display_name,
            host.username AS host_username, host.display_name AS host_display_name,
            p.title AS event_title
     FROM payments pay
     JOIN users payer ON payer.id = pay.payer_id
     JOIN users host ON host.id = pay.host_id
     JOIN events p ON p.id = pay.event_id
     ${where}
     ORDER BY pay.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  res.json({
    success: true,
    data: {
      payments: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

// ─────────────────────────────────────────────
// FINANCIAL OPERATIONS
// ─────────────────────────────────────────────

export async function listRefundJobs(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();

  const result = status ? await fetchRefundJobsByStatus(status, limit, offset) : await fetchRefundJobs(limit, offset);

  res.json({
    success: true,
    data: {
      refund_jobs: result.jobs,
      total: result.total,
      page,
      limit,
    },
  });
}

export async function retryRefundJobById(req: Request, res: Response) {
  const { id } = req.params;
  const job = await retryRefundJob(String(id));
  if (!job) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Refund job not found" } });
    return;
  }
  res.json({ success: true, data: { refund_job: job } });
}

export async function listHostPayouts(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const result = await fetchHostPayouts(limit, offset);

  res.json({
    success: true,
    data: {
      host_payouts: result.payouts,
      total: result.total,
      page,
      limit,
    },
  });
}

// ─────────────────────────────────────────────
// VERIFICATIONS
// ─────────────────────────────────────────────

export async function listVerifications(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();
  const validStatuses = ["pending", "approved", "rejected", "flagged"];

  const params: unknown[] = [];
  let statusClause = "";

  if (validStatuses.includes(status)) {
    params.push(status);
    statusClause = `WHERE hv.status = $${params.length}`;
  }

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM host_verifications hv ${statusClause}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const limitIdx = dataParams.length - 1;
  const offsetIdx = dataParams.length;

  const result = await query<Record<string, unknown>>(
    `SELECT hv.id, hv.user_id, hv.pan_name, hv.pan_number, hv.pan_image_url,
            hv.aadhaar_name, hv.aadhaar_number, hv.aadhaar_image_url,
            hv.bank_account_number, hv.bank_ifsc, hv.bank_account_name, hv.bank_name,
            hv.status, hv.rejection_reason, hv.auto_flags,
            hv.submitted_at, hv.reviewed_at,
            u.username, u.email, u.display_name, u.avatar_url
     FROM host_verifications hv
     JOIN users u ON u.id = hv.user_id
     ${statusClause}
     ORDER BY hv.submitted_at ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams
  );

  // Mask sensitive fields before returning to admin
  const verifications = result.rows.map((v) => {
    const pan = String(v.pan_number || "");
    const aadhaar = String(v.aadhaar_number || "");
    const acc = String(v.bank_account_number || "");
    return {
      ...v,
      pan_number_masked: pan.length === 10 ? `${pan.slice(0, 5)}****${pan[9]}` : "**********",
      aadhaar_number_masked: aadhaar.length >= 4 ? `********${aadhaar.slice(-4)}` : "************",
      bank_account_masked: acc.length >= 4 ? `${"*".repeat(acc.length - 4)}${acc.slice(-4)}` : "****",
      pan_number: undefined,
      aadhaar_number: undefined,
      bank_account_number: undefined,
    };
  });

  res.json({
    success: true,
    data: {
      verifications,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function reviewVerification(req: Request, res: Response) {
  const { userId } = req.params;
  const { status, rejection_reason } = req.body as { status: string; rejection_reason?: string };

  if (!["approved", "rejected"].includes(status)) {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Status must be approved or rejected" } });
    return;
  }

  const existing = await query(`SELECT user_id FROM host_verifications WHERE user_id = ?`, [String(userId)]);
  if (!existing.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Verification not found" } });
    return;
  }

  await reviewHostVerification(String(userId), "admin", status as "approved" | "rejected", rejection_reason);
  res.json({ success: true, data: { message: `Verification ${status}` } });
}

// ─────────────────────────────────────────────
// BROADCAST NOTIFICATION
// ─────────────────────────────────────────────

export async function broadcastNotification(req: Request, res: Response) {
  const { title, body } = req.body as { title?: string; body?: string };

  if (!title?.trim()) {
    res.status(400).json({ success: false, error: { code: "MISSING_TITLE", message: "Title is required" } });
    return;
  }

  const tokens = await getAllPushTokens();

  if (tokens.length === 0) {
    res.json({ success: true, data: { sent: 0, total: 0, message: "No push tokens registered" } });
    return;
  }

  const results = await Promise.allSettled(
    tokens.map((t) => sendPushToToken(t.token, title.trim(), body?.trim() || undefined))
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  res.json({
    success: true,
    data: { sent, total: tokens.length, message: `Sent to ${sent}/${tokens.length} devices` },
  });
}

// ─────────────────────────────────────────────
// MARKETPLACE SETTLEMENTS & REFUNDS
// ─────────────────────────────────────────────

export async function listRefundRequests(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;
  const status = String(req.query.status || "").trim();

  const params: unknown[] = [];
  let where = "";

  const validStatuses = ["pending_review", "approved", "rejected"];
  if (status && validStatuses.includes(status)) {
    params.push(status);
    where = `WHERE rr.status = ?`;
  }

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM refund_requests rr ${where}`,
    params
  );

  const dataParams = [...params, limit, offset];

  const result = await query(
    `SELECT rr.id, rr.payment_id, rr.event_id, rr.user_id, rr.amount, rr.reason, rr.status, rr.admin_note, rr.created_at, rr.updated_at,
            u.username AS guest_username, u.display_name AS guest_display_name,
            e.title AS event_title,
            pay.status AS payment_status, pay.amount AS payment_amount
     FROM refund_requests rr
     JOIN users u ON u.id = rr.user_id
     JOIN events e ON e.id = rr.event_id
     JOIN payments pay ON pay.id = rr.payment_id
     ${where}
     ORDER BY rr.created_at DESC
     LIMIT ? OFFSET ?`,
    dataParams
  );

  res.json({
    success: true,
    data: {
      refund_requests: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    },
  });
}

export async function reviewRefundRequest(req: Request, res: Response) {
  const id = req.params.id as string;
  const { status, admin_note, passcode } = req.body as {
    status: "approved" | "rejected";
    admin_note?: string;
    passcode?: string;
  };

  if (!["approved", "rejected"].includes(status)) {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Status must be approved or rejected" } });
    return;
  }

  if (status === "approved") {
    const requiredPasscode = process.env.ADMIN_PASSCODE || "123456";
    if (!passcode || passcode !== requiredPasscode) {
      res.status(401).json({ success: false, error: { code: "INVALID_PASSCODE", message: "Invalid admin passcode" } });
      return;
    }
  }

  const requestResult = await query(
    `SELECT * FROM refund_requests WHERE id = ?`,
    [id]
  );
  const refundReq = requestResult.rows[0];
  if (!refundReq) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Refund request not found" } });
    return;
  }

  if (refundReq.status !== "pending_review") {
    res.status(400).json({ success: false, error: { code: "ALREADY_PROCESSED", message: `This request has already been ${refundReq.status}` } });
    return;
  }

  const { query: dbQuery } = require("../../dblayer/connection");

  if (status === "approved") {
    await dbQuery(
      `UPDATE refund_requests
       SET status = 'approved', admin_note = ?, updated_at = NOW()
       WHERE id = ?`,
      [admin_note || "Approved by admin", id]
    );

    await enqueueRefundJob(refundReq.payment_id, refundReq.amount);

    res.json({ success: true, data: { message: "Refund request approved and refund job enqueued." } });
  } else {
    await dbQuery(
      `UPDATE refund_requests
       SET status = 'rejected', admin_note = ?, updated_at = NOW()
       WHERE id = ?`,
      [admin_note || "Rejected by admin", id]
    );

    res.json({ success: true, data: { message: "Refund request rejected." } });
  }
}

export async function releaseHostPayout(req: Request, res: Response) {
  const id = req.params.id as string;
  const { passcode } = req.body as { passcode?: string };

  const requiredPasscode = process.env.ADMIN_PASSCODE || "123456";
  if (!passcode || passcode !== requiredPasscode) {
    res.status(401).json({ success: false, error: { code: "INVALID_PASSCODE", message: "Invalid admin passcode" } });
    return;
  }

  const payoutResult = await query(
    `SELECT hp.*, hv.bank_account_number, hv.bank_ifsc, hv.bank_account_name, hv.bank_name
     FROM host_payouts hp
     LEFT JOIN host_verifications hv ON hv.user_id = hp.host_id AND hv.status = 'approved'
     WHERE hp.id = ?`,
    [id]
  );
  const payout = payoutResult.rows[0];
  if (!payout) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Host payout not found" } });
    return;
  }

  if (payout.status === "paid") {
    res.status(400).json({ success: false, error: { code: "ALREADY_PAID", message: "This payout has already been released and paid" } });
    return;
  }

  if (payout.status === "processing") {
    res.status(400).json({ success: false, error: { code: "PROCESSING", message: "This payout is currently processing" } });
    return;
  }

  if (!payout.bank_account_number || !payout.bank_ifsc) {
    res.status(400).json({ success: false, error: { code: "NO_BANK_DETAILS", message: "Host does not have approved KYC bank details" } });
    return;
  }

  await markHostPayoutProcessing(id);

  try {
    const transferId = await executeHostPayoutTransfer({
      id: payout.id,
      host_id: payout.host_id,
      net_amount: Number(payout.net_amount),
    });

    await markHostPayoutPaid(id, transferId);
    res.json({ success: true, data: { message: "Payout released and processed successfully.", transfer_id: transferId } });
  } catch (error: any) {
    logger.error("Error releasing host payout", error);
    await markHostPayoutFailed(id, error.message || "Unknown error during transfer");
    res.status(500).json({ success: false, error: { code: "TRANSFER_ERROR", message: error.message || "Error during transfer payout" } });
  }
}

export async function getPlatformSettings(_req: Request, res: Response) {
  const settings = await query(`SELECT key, value FROM platform_settings`);
  const data: Record<string, string> = {};
  for (const row of settings.rows) {
    data[row.key] = row.value;
  }
  res.json({
    success: true,
    data: {
      commission_enabled: data.commission_enabled === "true",
      commission_rate_percent: parseFloat(data.commission_rate_percent || "12.0"),
      auto_settlements_enabled: data.auto_settlements_enabled !== "false",
    }
  });
}

export async function updatePlatformSettings(req: Request, res: Response) {
  const { commission_enabled, commission_rate_percent, auto_settlements_enabled } = req.body as {
    commission_enabled?: boolean;
    commission_rate_percent?: number;
    auto_settlements_enabled?: boolean;
  };

  const { query: dbQuery } = require("../../dblayer/connection");

  if (commission_enabled !== undefined) {
    await dbQuery(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ('commission_enabled', ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [commission_enabled ? "true" : "false"]
    );
  }

  if (commission_rate_percent !== undefined) {
    if (commission_rate_percent < 0 || commission_rate_percent > 100) {
      res.status(400).json({ success: false, error: { code: "INVALID_RATE", message: "Commission rate must be between 0 and 100" } });
      return;
    }
    await dbQuery(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ('commission_rate_percent', ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [String(commission_rate_percent)]
    );
  }

  if (auto_settlements_enabled !== undefined) {
    await dbQuery(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ('auto_settlements_enabled', ?, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [auto_settlements_enabled ? "true" : "false"]
    );
  }

  res.json({ success: true, data: { message: "Platform settings updated successfully" } });
}

export async function updateHostOverrideRate(req: Request, res: Response) {
  const hostId = req.params.hostId as string;
  const { commission_override_rate } = req.body as { commission_override_rate: number | null };

  if (commission_override_rate !== null) {
    if (commission_override_rate < 0 || commission_override_rate > 100) {
      res.status(400).json({ success: false, error: { code: "INVALID_RATE", message: "Override rate must be between 0 and 100" } });
      return;
    }
  }

  const result = await query(
    `UPDATE users
     SET commission_override_rate = ?, updated_at = NOW()
     WHERE id = ?
     RETURNING id, username, commission_override_rate`,
    [commission_override_rate, hostId]
  );

  if (!result.rows[0]) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Host user not found" } });
    return;
  }

  res.json({ success: true, data: { host: result.rows[0] } });
}

export async function listHostOverrides(req: Request, res: Response) {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;

  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM users WHERE commission_override_rate IS NOT NULL`
  );

  const result = await query(
    `SELECT id, username, display_name, email, commission_override_rate
     FROM users
     WHERE commission_override_rate IS NOT NULL
     ORDER BY username ASC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  res.json({
    success: true,
    data: {
      hosts: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      limit,
    }
  });
}

export async function refundPaymentDirectly(req: Request, res: Response) {
  const paymentId = req.params.id as string;
  const { passcode, admin_note } = req.body as { passcode?: string; admin_note?: string };

  const requiredPasscode = process.env.ADMIN_PASSCODE || "123456";
  if (!passcode || passcode !== requiredPasscode) {
    res.status(401).json({ success: false, error: { code: "INVALID_PASSCODE", message: "Invalid admin passcode" } });
    return;
  }

  const paymentResult = await query(
    `SELECT * FROM payments WHERE id = ?`,
    [paymentId]
  );
  const payment = paymentResult.rows[0];
  if (!payment) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Payment not found" } });
    return;
  }

  if (payment.status !== "completed") {
    res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: `Payment is in ${payment.status} status and cannot be refunded` } });
    return;
  }

  // Create a record in refund_requests table as approved for bookkeeping/audit log
  const requestId = uuidv4();
  await query(
    `INSERT INTO refund_requests (
       id, payment_id, event_id, user_id, amount, reason, status, admin_note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'Direct Admin Refund', 'approved', ?, NOW(), NOW())`,
    [
      requestId,
      payment.id,
      payment.event_id,
      payment.payer_id,
      payment.amount,
      admin_note || "Refunded directly by admin",
    ]
  );

  // Enqueue the refund job directly
  await enqueueRefundJob(payment.id, payment.amount);

  res.json({ success: true, data: { message: "Payment refund initiated and enqueued successfully." } });
}

export async function forceHostPayout(req: Request, res: Response) {
  const { event_id, passcode } = req.body as { event_id?: string; passcode?: string };

  if (!event_id) {
    res.status(400).json({ success: false, error: { code: "INVALID_INPUT", message: "Event ID is required" } });
    return;
  }

  const requiredPasscode = process.env.ADMIN_PASSCODE || "123456";
  if (!passcode || passcode !== requiredPasscode) {
    res.status(401).json({ success: false, error: { code: "INVALID_PASSCODE", message: "Invalid admin passcode" } });
    return;
  }

  try {
    const payout = await enqueueHostPayoutForEvent(event_id);
    if (!payout) {
      res.status(400).json({ success: false, error: { code: "NO_PAYOUT_CREATED", message: "No payout could be created. Ensure the event has completed payments and has not been settled already." } });
      return;
    }

    res.json({
      success: true,
      data: {
        message: "Host payout record created successfully. You can now release it below.",
        payout,
      },
    });
  } catch (error: any) {
    logger.error("Error forcing host payout", error);
    res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: error.message || "Error generating payout" } });
  }
}
