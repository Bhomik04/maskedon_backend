import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

function toMySQLDatetime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
}

function calculatePartyStatus(party: PartyRow): "upcoming" | "ongoing" | "completed" | "cancelled" | "archived" {
  // If manually cancelled or archived, keep that status
  if (party.status === "cancelled" || party.status === "archived") {
    return party.status;
  }

  const now = new Date();
  const startTime = new Date(party.date_time);
  const endTime = party.end_time ? new Date(party.end_time) : null;

  // If end time has passed, party is completed
  if (endTime && now >= endTime) {
    return "completed";
  }

  // If start time has passed but end time hasn't, party is ongoing
  if (now >= startTime && (!endTime || now < endTime)) {
    return "ongoing";
  }

  // Otherwise, party is upcoming
  return "upcoming";
}

function updatePartyStatusIfNeeded<T extends PartyRow>(party: T): T {
  const newStatus = calculatePartyStatus(party);
  if (party.status !== newStatus) {
    party.status = newStatus;
  }
  return party;
}

// ============================================
// PARTY TYPES
// ============================================

export interface PartyRow {
  id: string;
  host_id: string;
  title: string;
  description: string | null;
  location_name: string;
  location_city: string;
  latitude: number | null;
  longitude: number | null;
  date_time: Date;
  end_time: Date | null;
  max_capacity: number;
  current_attendees: number;
  ticket_price: number;
  currency: string;
  cover_image_url: string | null;
  status: "upcoming" | "ongoing" | "completed" | "cancelled" | "archived";
  tags: string | null; // JSON string in MySQL
  min_rating: number;
  // Privacy & access
  is_private: boolean;
  private_code: string | null;
  allow_photos: boolean;
  // Party attributes
  food_type: "veg" | "non_veg" | "vegan" | null;
  allows_alcohol: boolean;
  allows_smoking: boolean;
  allows_other_substances: boolean;
  // Structured location
  location_country: string | null;
  location_state: string | null;
  location_district: string | null;
  // Revenue model
  host_commission_rate: number;
  deposit_amount: number;
  deposit_status: "not_required" | "pending" | "paid" | "refunded";
  deposit_payment_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CreatePartyInput {
  title: string;
  description?: string;
  location_name: string;
  location_city: string;
  latitude?: number;
  longitude?: number;
  date_time: string;
  end_time: string;
  ticket_price?: number;
  currency?: string;
  tags?: string[];
  min_rating?: number;
  cover_image_url?: string;
  // Privacy & access
  is_private?: boolean;
  allow_photos?: boolean;
  // Party attributes
  food_type?: "veg" | "non_veg" | "vegan";
  allows_alcohol?: boolean;
  allows_smoking?: boolean;
  allows_other_substances?: boolean;
  // Structured location
  location_country?: string;
  location_state?: string;
  location_district?: string;
  // Revenue model (optional on create — defaults applied by controller)
  host_commission_rate?: number;
}

// ============================================
// PARTY QUERIES
// ============================================

/** Generate a 10-char private code: first 6 from UUID + 4 random alphanumeric chars. */
function generatePrivateCode(partyId: string): string {
  const idPart = partyId.replace(/-/g, "").substring(0, 6).toUpperCase();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 to avoid confusion
  let key = "";
  for (let i = 0; i < 4; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return idPart + key;
}

export async function createParty(
  hostId: string,
  input: CreatePartyInput
): Promise<PartyRow> {
  const id = uuidv4();
  const isPrivate = input.is_private ?? false;
  const privateCode = isPrivate ? generatePrivateCode(id) : null;

  const ticketPrice = input.ticket_price || 0;
  const depositAmount = 0;
  const depositStatus = "not_required";
  const commissionRate = input.host_commission_rate ?? 12.5;

  await query(
    `INSERT INTO parties (
       id, host_id, title, description, location_name, location_city,
       latitude, longitude, date_time, end_time, ticket_price, currency,
       tags, min_rating, cover_image_url,
       is_private, private_code, allow_photos,
       food_type, allows_alcohol, allows_smoking, allows_other_substances,
       location_country, location_state, location_district,
       host_commission_rate, deposit_amount, deposit_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      hostId,
      input.title,
      input.description || null,
      input.location_name,
      input.location_city,
      input.latitude ?? null,
      input.longitude ?? null,
      toMySQLDatetime(input.date_time),
      toMySQLDatetime(input.end_time),
      ticketPrice,
      input.currency || "INR",
      input.tags ? JSON.stringify(input.tags) : null,
      input.min_rating || 0,
      input.cover_image_url || null,
      isPrivate,
      privateCode,
      input.allow_photos ?? true,
      input.food_type || null,
      input.allows_alcohol ?? false,
      input.allows_smoking ?? false,
      input.allows_other_substances ?? false,
      input.location_country || null,
      input.location_state || null,
      input.location_district || null,
      commissionRate,
      depositAmount,
      depositStatus,
    ]
  );
  const result = await query<PartyRow>("SELECT * FROM parties WHERE id = ?", [id]);
  return result.rows[0]!;
}

export async function markDepositPaid(partyId: string, paymentId: string): Promise<void> {
  await query(
    `UPDATE parties SET deposit_status = 'paid', deposit_payment_id = ? WHERE id = ? AND deposit_status = 'pending'`,
    [paymentId, partyId]
  );
}

export async function markDepositRefunded(partyId: string): Promise<void> {
  await query(
    `UPDATE parties SET deposit_status = 'refunded' WHERE id = ? AND deposit_status = 'paid'`,
    [partyId]
  );
}

export async function findPartyById(id: string): Promise<PartyRow | null> {
  const result = await query<PartyRow>(
    "SELECT * FROM parties WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  const party = result.rows[0];
  return party ? updatePartyStatusIfNeeded(party) : null;
}

export interface PartyWithHost extends PartyRow {
  host_username: string;
  host_display_name: string;
  host_avatar_url: string | null;
  host_social_rating: number;
}

export async function findPartyByIdWithHost(id: string): Promise<PartyWithHost | null> {
  const result = await query<PartyWithHost>(
    `SELECT p.*, u.username AS host_username, u.display_name AS host_display_name,
            u.avatar_url AS host_avatar_url, u.social_rating AS host_social_rating
     FROM parties p
     JOIN users u ON u.id = p.host_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [id]
  );
  const party = result.rows[0];
  return party ? updatePartyStatusIfNeeded(party) : null;
}

export interface DiscoverFilters {
  city?: string;
  min_date?: string;
  max_date?: string;
  max_price?: number;
  tags?: string[];
  search?: string;
  sort?: "date_asc" | "date_desc" | "price_asc" | "price_desc" | "trending";
  page?: number;
  limit?: number;
  /** The requesting user's social_rating — used to enforce party min_rating gate. */
  viewer_rating?: number;
}

export interface PartyTagSuggestion {
  tag: string;
  uses: number;
}

export async function getPopularPartyTags(search?: string, limit = 10): Promise<PartyTagSuggestion[]> {
  const safeLimit = Math.max(1, Math.min(limit || 10, 25));
  const params: (string | number)[] = [];

  let whereClause = "p.deleted_at IS NULL AND p.tags IS NOT NULL";
  if (search && search.trim()) {
    whereClause += " AND LOWER(tag.value) LIKE LOWER(?)";
    params.push(`%${search.trim()}%`);
  }

  params.push(safeLimit);

  const result = await query<PartyTagSuggestion>(
    `SELECT LOWER(tag.value) AS tag, COUNT(*) AS uses
     FROM parties p
     JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(p.tags) = 'array' THEN p.tags ELSE '[]'::jsonb END
     ) AS tag(value) ON TRUE
     WHERE ${whereClause}
     GROUP BY LOWER(tag.value)
     ORDER BY COUNT(*) DESC, tag ASC
     LIMIT ?`,
    params
  );

  return result.rows.map((row) => ({
    tag: row.tag,
    uses: Number(row.uses) || 0,
  }));
}

export async function discoverParties(
  filters: DiscoverFilters
): Promise<{ parties: PartyWithHost[]; total: number }> {
  const conditions: string[] = ["p.deleted_at IS NULL"];
  const params: any[] = [];

  // Exclude private parties from discovery
  conditions.push("p.is_private = FALSE");

  // Pre-filter to upcoming/ongoing by date to avoid loading completed parties
  conditions.push("(p.status NOT IN ('cancelled', 'archived'))");
  conditions.push("((p.end_time IS NULL AND p.date_time >= NOW() - INTERVAL '24 hours') OR p.end_time >= NOW())");

  if (filters.city) {
    conditions.push("p.location_city = ?");
    params.push(filters.city);
  }
  if (filters.min_date) {
    conditions.push("p.date_time >= ?");
    params.push(filters.min_date);
  }
  if (filters.max_date) {
    conditions.push("p.date_time <= ?");
    params.push(filters.max_date);
  }
  if (filters.max_price !== undefined) {
    conditions.push("p.ticket_price <= ?");
    params.push(filters.max_price);
  }
  // Only show parties the requesting user is qualified to join (min_rating gate).
  // A min_rating of 0 means no restriction.
  if (filters.viewer_rating !== undefined) {
    conditions.push("(p.min_rating = 0 OR p.min_rating <= ?)");
    params.push(filters.viewer_rating);
  }
  if (filters.search) {
    conditions.push("(p.title LIKE ? OR p.description LIKE ? OR p.location_name LIKE ?)");
    const safeTerm = filters.search.replace(/[%_\\]/g, (c) => `\\${c}`);
    const term = `%${safeTerm}%`;
    params.push(term, term, term);
  }

  const where = conditions.join(" AND ");

  // Count total
  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM parties p WHERE ${where}`,
    params
  );
  const total = countResult.rows[0]?.total || 0;

  // Sort
  let orderBy = "p.date_time ASC";
  if (filters.sort === "date_desc") orderBy = "p.date_time DESC";
  else if (filters.sort === "price_asc") orderBy = "p.ticket_price ASC";
  else if (filters.sort === "price_desc") orderBy = "p.ticket_price DESC";
  else if (filters.sort === "trending") {
    orderBy = `
      (GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 604800) * 0.65
      + p.current_attendees * 0.35)
      DESC,
      p.date_time ASC
    `;
  }

  // Paginate
  const limit = Math.max(1, Math.min(filters.limit || 20, 100));
  const page = Math.max(filters.page || 1, 1);
  const offset = (page - 1) * limit;

  const dataParams = [...params, limit, offset];
  const result = await query<PartyWithHost>(
    `SELECT p.*, u.username AS host_username, u.display_name AS host_display_name,
            u.avatar_url AS host_avatar_url, u.social_rating AS host_social_rating
     FROM parties p
     JOIN users u ON u.id = p.host_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    dataParams
  );

  // Update calculated status for all parties
  const parties = result.rows.map((p) => updatePartyStatusIfNeeded(p));

  return { parties, total };
}

export async function updateParty(
  id: string,
  fields: Partial<Pick<CreatePartyInput,
    "title" | "description" | "location_name" | "location_city" | "date_time" | "end_time" |
    "ticket_price" | "tags" | "min_rating" | "allow_photos" |
    "food_type" | "allows_alcohol" | "allows_smoking" | "allows_other_substances" |
    "location_country" | "location_state" | "location_district"
  >> & { cover_image_url?: string | null }
): Promise<PartyRow | null> {
  const setClauses: string[] = [];
  const values: any[] = [];

  if (fields.title !== undefined) { setClauses.push("title = ?"); values.push(fields.title); }
  if (fields.description !== undefined) { setClauses.push("description = ?"); values.push(fields.description); }
  if (fields.location_name !== undefined) { setClauses.push("location_name = ?"); values.push(fields.location_name); }
  if (fields.location_city !== undefined) { setClauses.push("location_city = ?"); values.push(fields.location_city); }
  if (fields.date_time !== undefined) { setClauses.push("date_time = ?"); values.push(toMySQLDatetime(fields.date_time)); }
  if (fields.end_time !== undefined) { setClauses.push("end_time = ?"); values.push(fields.end_time ? toMySQLDatetime(fields.end_time) : null); }
  if (fields.ticket_price !== undefined) { setClauses.push("ticket_price = ?"); values.push(fields.ticket_price); }
  if (fields.tags !== undefined) { setClauses.push("tags = ?"); values.push(JSON.stringify(fields.tags)); }
  if (fields.min_rating !== undefined) { setClauses.push("min_rating = ?"); values.push(fields.min_rating); }
  if (fields.cover_image_url !== undefined) { setClauses.push("cover_image_url = ?"); values.push(fields.cover_image_url); }
  if (fields.allow_photos !== undefined) { setClauses.push("allow_photos = ?"); values.push(fields.allow_photos); }
  if (fields.food_type !== undefined) { setClauses.push("food_type = ?"); values.push(fields.food_type); }
  if (fields.allows_alcohol !== undefined) { setClauses.push("allows_alcohol = ?"); values.push(fields.allows_alcohol); }
  if (fields.allows_smoking !== undefined) { setClauses.push("allows_smoking = ?"); values.push(fields.allows_smoking); }
  if (fields.allows_other_substances !== undefined) { setClauses.push("allows_other_substances = ?"); values.push(fields.allows_other_substances); }
  if (fields.location_country !== undefined) { setClauses.push("location_country = ?"); values.push(fields.location_country); }
  if (fields.location_state !== undefined) { setClauses.push("location_state = ?"); values.push(fields.location_state); }
  if (fields.location_district !== undefined) { setClauses.push("location_district = ?"); values.push(fields.location_district); }

  if (setClauses.length === 0) return findPartyById(id);

  values.push(id);
  await query(
    `UPDATE parties SET ${setClauses.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
    values
  );
  return findPartyById(id);
}

/** Find a private party by its 10-char private code. */
export async function findPartyByPrivateCode(code: string): Promise<PartyWithHost | null> {
  const result = await query<PartyWithHost>(
    `SELECT p.*, u.username AS host_username, u.display_name AS host_display_name,
            u.avatar_url AS host_avatar_url, u.social_rating AS host_social_rating
     FROM parties p
     JOIN users u ON u.id = p.host_id
     WHERE p.private_code = ? AND p.is_private = TRUE AND p.deleted_at IS NULL`,
    [code]
  );
  const party = result.rows[0];
  return party ? updatePartyStatusIfNeeded(party) : null;
}

export async function cancelParty(id: string, hostId: string): Promise<void> {
  await query("UPDATE parties SET status = 'cancelled' WHERE id = ? AND host_id = ?", [id, hostId]);
}

// ============================================
// HOST ANALYTICS (aggregated dashboard data)
// ============================================

export interface HostAnalytics {
  revenue: {
    total: number;         // paisa
    this_month: number;
    last_month: number;
    currency: string;
  };
  parties: {
    total: number;
    upcoming: number;
    ongoing: number;
    completed: number;
    cancelled: number;
  };
  attendance: {
    total_attendees: number;
    total_capacity: number;
    avg_occupancy: number;   // 0-100
  };
  requests: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    approval_rate: number;   // 0-100
  };
  ratings: {
    avg_party_rating: number | null;
    total_votes: number;
    parties_rated: number;
  };
  top_party: {
    id: string;
    title: string;
    attendees: number;
    revenue: number;
  } | null;
}

export async function getHostAnalytics(hostId: string): Promise<HostAnalytics> {
  // 1. Party counts by status
  const partyCounts = await query<{ status: string; cnt: string }>(
    `SELECT 
       CASE 
         WHEN status = 'cancelled' THEN 'cancelled'
         WHEN end_time IS NOT NULL AND end_time < NOW() THEN 'completed'
         WHEN date_time < NOW() AND (end_time IS NULL OR end_time > NOW()) THEN 'ongoing'
         ELSE 'upcoming'
       END AS status,
       COUNT(*) AS cnt
     FROM parties
     WHERE host_id = ? AND deleted_at IS NULL
     GROUP BY 1`,
    [hostId]
  );
  const pc: Record<string, number> = {};
  for (const r of partyCounts.rows) pc[r.status] = parseInt(r.cnt, 10);

  // 2. Revenue
  const revTotal = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM payments WHERE host_id = ? AND status = 'completed'`,
    [hostId]
  );
  const revThisMonth = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM payments WHERE host_id = ? AND status = 'completed'
       AND completed_at >= date_trunc('month', NOW())`,
    [hostId]
  );
  const revLastMonth = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM payments WHERE host_id = ? AND status = 'completed'
       AND completed_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
       AND completed_at < date_trunc('month', NOW())`,
    [hostId]
  );

  // 3. Attendance
  const attendance = await query<{ total_attendees: string; total_capacity: string }>(
    `SELECT COALESCE(SUM(current_attendees), 0) AS total_attendees,
            COALESCE(SUM(max_capacity), 0) AS total_capacity
     FROM parties WHERE host_id = ? AND deleted_at IS NULL AND status != 'cancelled'`,
    [hostId]
  );
  const totalAtt = parseInt(attendance.rows[0]?.total_attendees || "0", 10);
  const totalCap = parseInt(attendance.rows[0]?.total_capacity || "0", 10);

  // 4. Request stats
  const reqStats = await query<{ status: string; cnt: string }>(
    `SELECT r.status, COUNT(*) AS cnt
     FROM party_requests r
     JOIN parties p ON p.id = r.party_id
     WHERE p.host_id = ? AND p.deleted_at IS NULL
     GROUP BY r.status`,
    [hostId]
  );
  const rc: Record<string, number> = {};
  for (const r of reqStats.rows) rc[r.status] = parseInt(r.cnt, 10);
  const totalDecided = (rc["approved"] || 0) + (rc["rejected"] || 0);

  // 5. Rating stats
  const ratingStats = await query<{ avg_score: string | null; total_votes: string; parties_rated: string }>(
    `SELECT AVG(cr.score) AS avg_score, COUNT(*) AS total_votes,
            COUNT(DISTINCT cr.party_id) AS parties_rated
     FROM crowd_ratings cr
     JOIN parties p ON p.id = cr.party_id
     WHERE p.host_id = ? AND p.deleted_at IS NULL`,
    [hostId]
  );

  // 6. Top party by revenue
  const topParty = await query<{ id: string; title: string; attendees: string; revenue: string }>(
    `SELECT p.id, p.title, p.current_attendees AS attendees,
            COALESCE(SUM(pay.amount), 0) AS revenue
     FROM parties p
     LEFT JOIN payments pay ON pay.party_id = p.id AND pay.status = 'completed'
     WHERE p.host_id = ? AND p.deleted_at IS NULL AND p.status != 'cancelled'
     GROUP BY p.id, p.title, p.current_attendees
     ORDER BY revenue DESC, attendees DESC
     LIMIT 1`,
    [hostId]
  );

  const rs = ratingStats.rows[0];

  return {
    revenue: {
      total: parseInt(revTotal.rows[0]?.total || "0", 10),
      this_month: parseInt(revThisMonth.rows[0]?.total || "0", 10),
      last_month: parseInt(revLastMonth.rows[0]?.total || "0", 10),
      currency: "INR",
    },
    parties: {
      total: (pc["upcoming"] || 0) + (pc["ongoing"] || 0) + (pc["completed"] || 0) + (pc["cancelled"] || 0),
      upcoming: pc["upcoming"] || 0,
      ongoing: pc["ongoing"] || 0,
      completed: pc["completed"] || 0,
      cancelled: pc["cancelled"] || 0,
    },
    attendance: {
      total_attendees: totalAtt,
      total_capacity: totalCap,
      avg_occupancy: totalCap > 0 ? Math.round((totalAtt / totalCap) * 100) : 0,
    },
    requests: {
      total: Object.values(rc).reduce((a, b) => a + b, 0),
      pending: rc["pending"] || 0,
      approved: rc["approved"] || 0,
      rejected: rc["rejected"] || 0,
      approval_rate: totalDecided > 0 ? Math.round(((rc["approved"] || 0) / totalDecided) * 100) : 0,
    },
    ratings: {
      avg_party_rating: rs?.avg_score ? Math.round(parseFloat(rs.avg_score) * 100) / 100 : null,
      total_votes: parseInt(rs?.total_votes || "0", 10),
      parties_rated: parseInt(rs?.parties_rated || "0", 10),
    },
    top_party: topParty.rows[0]
      ? {
          id: topParty.rows[0].id,
          title: topParty.rows[0].title,
          attendees: parseInt(topParty.rows[0].attendees, 10),
          revenue: parseInt(topParty.rows[0].revenue, 10),
        }
      : null,
  };
}

export async function getPartiesByHost(hostId: string): Promise<PartyRow[]> {
  const result = await query<PartyRow>(
    "SELECT * FROM parties WHERE host_id = ? AND deleted_at IS NULL ORDER BY date_time DESC",
    [hostId]
  );
  return result.rows.map((p) => updatePartyStatusIfNeeded(p));
}

export async function incrementAttendeeCount(partyId: string): Promise<void> {
  await query(
    "UPDATE parties SET current_attendees = current_attendees + 1 WHERE id = ?",
    [partyId]
  );
}

/**
 * Atomically increment attendee count only if capacity has not been reached.
 * Returns true if the increment succeeded, false if the party was already full.
 * Eliminates the read-then-write race condition.
 */
export async function atomicIncrementAttendeeCount(partyId: string): Promise<boolean> {
  const result = await query(
    "UPDATE parties SET current_attendees = current_attendees + 1 WHERE id = ? AND current_attendees < max_capacity",
    [partyId]
  );
  return result.affectedRows > 0;
}

export async function incrementHostedCount(userId: string): Promise<void> {
  await query(
    "UPDATE users SET parties_hosted = parties_hosted + 1 WHERE id = ?",
    [userId]
  );
}

export async function incrementAttendedCount(userId: string): Promise<void> {
  await query(
    "UPDATE users SET parties_attended = parties_attended + 1 WHERE id = ?",
    [userId]
  );
}

// ============================================
// FRIENDS ATTENDING (for discover enrichment)
// ============================================

export interface FriendAttending {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface PartyFriendsMap {
  [partyId: string]: { count: number; friends: FriendAttending[] };
}

export async function getFriendsAttendingParties(
  userId: string,
  partyIds: string[]
): Promise<PartyFriendsMap> {
  if (partyIds.length === 0) return {};

  const placeholders = partyIds.map(() => "?").join(", ");
  const result = await query<{
    party_id: string;
    user_id: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `SELECT a.party_id, a.user_id, u.display_name, u.avatar_url
     FROM party_attendees a
     JOIN users u ON u.id = a.user_id
     WHERE a.party_id IN (${placeholders})
       AND a.user_id IN (
         SELECT CASE
           WHEN f.requester_id = ? THEN f.addressee_id
           ELSE f.requester_id
         END
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = ? OR f.addressee_id = ?)
       )
     ORDER BY a.joined_at DESC`,
    [...partyIds, userId, userId, userId]
  );

  const map: PartyFriendsMap = {};
  for (const row of result.rows) {
    if (!map[row.party_id]) map[row.party_id] = { count: 0, friends: [] };
    map[row.party_id].count++;
    if (map[row.party_id].friends.length < 3) {
      map[row.party_id].friends.push({
        user_id: row.user_id,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
      });
    }
  }
  return map;
}

export async function searchAllParties(
  term: string,
  limit: number
): Promise<PartyRow[]> {
  // Escape ILIKE wildcards for the fallback ILIKE clause
  const safeTerm = term.replace(/[%_\\]/g, (c) => `\\${c}`);
  const like = `%${safeTerm}%`;
  const safeLimit = Math.max(1, Math.min(limit, 50));

  // Use pg_trgm similarity for fuzzy, typo-tolerant ranked search.
  // Falls back to ILIKE so exact substring matches always appear.
  const result = await query<PartyRow>(
    `SELECT *,
       GREATEST(
         similarity(title, ?),
         similarity(COALESCE(description, ''), ?) * 0.6,
         similarity(location_city, ?) * 0.7
       ) AS _rank
     FROM parties
     WHERE deleted_at IS NULL
       AND is_private = FALSE
       AND status NOT IN ('cancelled', 'archived')
       AND (
         similarity(title, ?) > 0.1
         OR similarity(COALESCE(description, ''), ?) > 0.08
         OR similarity(location_city, ?) > 0.1
         OR title ILIKE ?
         OR location_city ILIKE ?
       )
     ORDER BY _rank DESC, date_time ASC
     LIMIT ?`,
    [term, term, term, term, term, term, like, like, safeLimit]
  );
  return result.rows.map((p) => updatePartyStatusIfNeeded(p));
}
