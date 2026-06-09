import { Request, Response } from "express";
import { findEventById } from "../../dblayer/event-queries";
import { getMyTicket, getGroupSlots, scanAndCheckIn, getAllMyTickets } from "../../dblayer/payment-queries";

// GET /api/v1/users/me/tickets
export async function listMyTickets(req: Request, res: Response) {
  const userId = req.user!.userId;
  const activeTickets = await getAllMyTickets(userId) as any[];

  const { query: dbQuery } = require("../../dblayer/connection");
  const refundResult = await dbQuery(
    `SELECT rr.id AS refund_request_id, rr.event_id, rr.user_id, rr.amount, rr.status AS refund_status, rr.admin_note, rr.created_at,
            p.title AS event_title, p.date_time AS event_date_time, p.end_time AS event_end_time,
            p.location_name AS event_location_name, p.location_city AS event_location_city,
            p.cover_image_url AS event_cover_image_url, p.ticket_price AS event_ticket_price
     FROM refund_requests rr
     JOIN events p ON p.id = rr.event_id
     WHERE rr.user_id = ?`,
    [userId]
  );

  const refundTickets = refundResult.rows.map((row: any) => ({
    attendee_id: row.refund_request_id,
    event_id: row.event_id,
    user_id: row.user_id,
    qr_token: "",
    checked_in: false,
    event_title: row.event_title,
    event_date_time: row.event_date_time,
    event_end_time: row.event_end_time,
    event_location_name: row.event_location_name,
    event_location_city: row.event_location_city,
    event_cover_image_url: row.event_cover_image_url,
    event_ticket_price: row.event_ticket_price,
    refund_status: row.refund_status,
    refund_admin_note: row.admin_note,
  }));

  const activeEventIds = new Set(activeTickets.map(t => t.event_id));
  const combinedTickets = [
    ...activeTickets,
    ...refundTickets.filter((rt: any) => !activeEventIds.has(rt.event_id))
  ];

  res.json({ success: true, data: { tickets: combinedTickets } });
}

// GET /api/v1/events/:eventId/my-ticket
export async function getTicket(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  let ticket = await getMyTicket(eventId, userId) as any;
  let refundRequest: any = null;

  const { query: dbQuery } = require("../../dblayer/connection");
  const refundResult = await dbQuery(
    `SELECT rr.id, rr.amount, rr.status, rr.admin_note, rr.created_at
     FROM refund_requests rr
     WHERE rr.event_id = ? AND rr.user_id = ?`,
    [eventId, userId]
  );
  if (refundResult.rows[0]) {
    refundRequest = refundResult.rows[0];
  }

  if (!ticket) {
    if (refundRequest) {
      const eventResult = await dbQuery(
        `SELECT p.id AS event_id, p.title AS event_title, p.date_time AS event_date_time, p.cover_image_url AS event_cover_image_url,
                p.ticket_price AS event_ticket_price, p.location_city AS event_location_city, p.max_capacity AS event_max_capacity,
                p.current_attendees AS event_current_attendees, p.tags AS event_tags, u.display_name AS guest_display_name,
                u.username AS guest_username, u.avatar_url AS guest_avatar_url, u.social_rating AS guest_social_rating
         FROM events p
         JOIN users u ON u.id = ?
         WHERE p.id = ?`,
        [userId, eventId]
      );
      const ev = eventResult.rows[0];
      if (ev) {
        ticket = {
          ...ev,
          attendee_id: refundRequest.id,
          qr_token: "",
          checked_in: false,
          refund_status: refundRequest.status,
          refund_admin_note: refundRequest.admin_note,
        };
      }
    }
  } else if (refundRequest) {
    ticket.refund_status = refundRequest.status;
    ticket.refund_admin_note = refundRequest.admin_note;
  }

  if (!ticket) {
    res.status(404).json({ success: false, error: { code: "NO_TICKET", message: "You do not have a ticket for this event" } });
    return;
  }

  // Fetch all group slots if this is a multi-slot ticket
  const groupSlots = ticket.group_size > 1 ? await getGroupSlots(eventId, userId) : [];

  res.json({ success: true, data: { ticket, group_slots: groupSlots } });
}

// POST /api/v1/events/:eventId/scan-ticket
// Body: { token: string }
export async function scanTicket(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const hostId = req.user!.userId;

  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    return;
  }

  if (event.host_id !== hostId) {
    res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Only the host can scan tickets" } });
    return;
  }

  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string" || token.length !== 64 || !/^[0-9a-f]+$/.test(token)) {
    res.status(400).json({ success: false, error: { code: "INVALID_TOKEN", message: "Invalid QR token format" } });
    return;
  }

  const result = await scanAndCheckIn(eventId, token);
  if (!result) {
    res.status(404).json({ success: false, error: { code: "INVALID_TOKEN", message: "QR code not valid for this event" } });
    return;
  }

  res.json({ success: true, data: { ticket: result.ticket, already_checked_in: result.already_checked_in } });
}
