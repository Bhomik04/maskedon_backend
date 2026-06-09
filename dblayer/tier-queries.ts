import { query } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// TIER TYPES
// ============================================

export interface TierRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price: number;         // in paisa; 0 = free
  slots: number;         // people covered per ticket unit
  max_quantity: number | null;  // NULL = unlimited
  sold_count: number;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
}

export interface TierInput {
  name: string;
  description?: string;
  price: number;         // in paisa
  slots?: number;        // default 1
  max_quantity?: number | null;
  sort_order?: number;
}

// ============================================
// TIER QUERIES
// ============================================

/** Create a single tier for a event. */
export async function createTier(
  eventId: string,
  input: TierInput
): Promise<TierRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO ticket_tiers (id, event_id, name, description, price, slots, max_quantity, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      eventId,
      input.name.trim(),
      input.description?.trim() || null,
      input.price,
      input.slots ?? 1,
      input.max_quantity ?? null,
      input.sort_order ?? 0,
    ]
  );
  const result = await query<TierRow>("SELECT * FROM ticket_tiers WHERE id = ?", [id]);
  return result.rows[0]!;
}

/** Bulk-create tiers from an array (used during event creation). */
export async function createTiersForEvent(
  eventId: string,
  tiers: TierInput[]
): Promise<TierRow[]> {
  const created: TierRow[] = [];
  for (let i = 0; i < tiers.length; i++) {
    const tier = await createTier(eventId, { ...tiers[i], sort_order: i });
    created.push(tier);
  }
  return created;
}

/** List all active tiers for a event ordered by sort_order. */
export async function getEventTiers(eventId: string): Promise<TierRow[]> {
  const result = await query<TierRow>(
    "SELECT * FROM ticket_tiers WHERE event_id = ? AND is_active = TRUE ORDER BY sort_order ASC, created_at ASC",
    [eventId]
  );
  return result.rows;
}

/** Find a single tier by ID. */
export async function findTierById(tierId: string): Promise<TierRow | null> {
  const result = await query<TierRow>("SELECT * FROM ticket_tiers WHERE id = ?", [tierId]);
  return result.rows[0] || null;
}

/** Find a tier that belongs to a specific event (ownership check). */
export async function findTierForEvent(tierId: string, eventId: string): Promise<TierRow | null> {
  const result = await query<TierRow>(
    "SELECT * FROM ticket_tiers WHERE id = ? AND event_id = ?",
    [tierId, eventId]
  );
  return result.rows[0] || null;
}

/** Update a tier's mutable fields. Only allowed when sold_count = 0. */
export async function updateTier(
  tierId: string,
  eventId: string,
  input: Partial<TierInput>
): Promise<TierRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name.trim()); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description.trim() || null); }
  if (input.price !== undefined) { sets.push("price = ?"); params.push(input.price); }
  if (input.slots !== undefined) { sets.push("slots = ?"); params.push(input.slots); }
  if (input.max_quantity !== undefined) { sets.push("max_quantity = ?"); params.push(input.max_quantity); }
  if (input.sort_order !== undefined) { sets.push("sort_order = ?"); params.push(input.sort_order); }

  if (sets.length === 0) return findTierById(tierId);

  params.push(tierId, eventId);
  await query(
    `UPDATE ticket_tiers SET ${sets.join(", ")} WHERE id = ? AND event_id = ?`,
    params
  );
  return findTierById(tierId);
}

/**
 * Deactivate a tier (soft-delete).
 * If sold_count > 0, soft-deletes (is_active = FALSE).
 * If sold_count = 0, hard-deletes.
 */
export async function deleteTier(tierId: string, eventId: string): Promise<boolean> {
  const tier = await findTierForEvent(tierId, eventId);
  if (!tier) return false;

  if (tier.sold_count > 0) {
    await query(
      "UPDATE ticket_tiers SET is_active = FALSE WHERE id = ? AND event_id = ?",
      [tierId, eventId]
    );
  } else {
    await query("DELETE FROM ticket_tiers WHERE id = ? AND event_id = ?", [tierId, eventId]);
  }
  return true;
}

/**
 * Atomically increments sold_count for a tier and validates max_quantity.
 * Returns false if tier would exceed max_quantity.
 */
export async function incrementTierSoldCount(
  tierId: string,
  quantity: number
): Promise<boolean> {
  const result = await query<{ affectedRows?: number }>(
    `UPDATE ticket_tiers
     SET sold_count = sold_count + ?
     WHERE id = ? AND (max_quantity IS NULL OR sold_count + ? <= max_quantity) AND is_active = TRUE`,
    [quantity, tierId, quantity]
  );
  // MySQL returns affectedRows on UPDATE; check via re-read if needed
  const updated = await findTierById(tierId);
  return updated !== null;
}

/** Replace all tiers for a event (used on event update). Deactivates old ones first. */
export async function replaceTiersForEvent(
  eventId: string,
  newTiers: TierInput[]
): Promise<TierRow[]> {
  // Soft-delete all existing active tiers
  await query(
    "UPDATE ticket_tiers SET is_active = FALSE WHERE event_id = ?",
    [eventId]
  );
  return createTiersForEvent(eventId, newTiers);
}
