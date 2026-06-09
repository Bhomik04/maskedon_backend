// Event Score Algorithm — Pure function, no DB or HTTP imports.
//
// Calculates each individual user's adjusted score for a specific event,
// layering two modifiers on top of the raw crowd average:
//   1. Friend Bonus   — rewarded for having friends in the event
//   2. Report Penalty — penalised for being reported during the event
//
// This per-event score then feeds into the user's overall social rating
// (averaged across all events they have attended or hosted).

// ─────────────────────────────────────────────────────────────────────────────
// Configuration constants
// ─────────────────────────────────────────────────────────────────────────────

/** Stars added to the rating numerator per friend the user has among the attendees. */
const FRIEND_BONUS_PER_FRIEND = 2;

/** Hard ceiling — no score can exceed 5.0, even with many friends. */
const MAX_SCORE = 5.0;

/** Hard floor — no score can drop below 1.0. */
const MIN_SCORE = 1.0;

/**
 * Score forced when the user receives exactly 2 reports in this event.
 * Friends bonus is ignored when this bracket is reached.
 */
const TWO_REPORT_FORCED_SCORE = 2.0;

/**
 * Score forced when the user receives 3 or more reports in this event.
 * Friends bonus is ignored when this bracket is reached.
 */
const THREE_PLUS_REPORT_FORCED_SCORE = 1.0;

/** Stars deducted from the friend-adjusted score when exactly 1 report is filed. */
const ONE_REPORT_DEDUCTION = 1.0;

/** Minimum events a user must have attended before their rating is shown publicly. */
const MIN_EVENTS_FOR_DISPLAY = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface EventScoreInput {
  /**
   * Sum of all crowd rating scores submitted for this event.
   * Example: 10 people each gave 3 stars → ratingSum = 30.
   */
  ratingSum: number;

  /**
   * Total number of attendees in the event.
   * Used as the denominator for both the base average and the friend bonus.
   * Must be ≥ 1.
   */
  eventAttendeeCount: number;

  /**
   * Number of accepted friends this user has among the event attendees.
   * Used to compute the friend bonus added to the numerator.
   *
   * DB note: query friendships where status = 'accepted' AND
   *   (requester_id = userId OR addressee_id = userId)
   *   AND the other user is in event_attendees for this event.
   */
  friendsInEvent: number;

  /**
   * Number of reports filed against this user within the context of this event.
   * Only "open" or "reviewed" reports should count (not dismissed ones).
   *
   * DB note: an `event_id` column should be added to the reports table to scope
   * reports to a specific event. Until then, use reports where target_type = 'user'
   * AND target_id = userId AND the report was created within the event's time window.
   */
  reportsInEvent: number;
}

/** Which report penalty bracket was triggered. */
export type ReportPenaltyBracket =
  | "none"       // 0 reports — no penalty
  | "minus_one"  // 1 report  — friends bonus applied, then −1 deducted
  | "forced_two" // 2 reports — score forced to 2.0, friends ignored
  | "forced_one" // ≥3 reports — score forced to 1.0, friends ignored

export interface EventScoreResult {
  /** Raw event average: ratingSum / eventAttendeeCount. Clamped to [1.0, 5.0]. */
  baseScore: number;

  /**
   * Score after applying the friend bonus (before any report penalty).
   * Equal to baseScore when friendsInEvent = 0, or when reports > 1 (bonus skipped).
   * Capped at 5.0.
   */
  friendAdjustedScore: number;

  /**
   * Final score after all adjustments.
   * Always in [1.0, 5.0].
   * This is the value that contributes to the user's overall social rating.
   */
  finalScore: number;

  /** True if a friend bonus was calculated and incorporated. */
  friendBonusApplied: boolean;

  /** Which report penalty bracket was applied. */
  appliedPenalty: ReportPenaltyBracket;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: per-event score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates the adjusted event score for a single user.
 *
 * ── Step 1: Base average ────────────────────────────────────────────────────
 *   baseScore = ratingSum / eventAttendeeCount
 *
 * ── Step 2: Friend bonus ────────────────────────────────────────────────────
 *   Applied only when reportsInEvent ≤ 1 (reports override friends when > 1).
 *
 *   bonusPoints = friendsInEvent × 2
 *   friendAdjustedScore = (ratingSum + bonusPoints) / eventAttendeeCount
 *   → Capped at 5.0
 *
 * ── Step 3: Report penalty ──────────────────────────────────────────────────
 *
 *   reportsInEvent │ Rule
 *   ───────────────┼──────────────────────────────────────────────────────────
 *        0         │ friendAdjustedScore is the final score (capped at 5.0)
 *        1         │ friendAdjustedScore − 1.0, minimum 1.0
 *        2         │ Forced to 2.0 regardless of event avg or friends
 *       ≥ 3        │ Forced to 1.0 regardless of event avg or friends
 *   ───────────────┴──────────────────────────────────────────────────────────
 *
 * ── Examples ─────────────────────────────────────────────────────────────────
 *
 *   A) 10 attendees, avg = 4.0 (sum=40), 1 report, 0 friends
 *      → friendAdjustedScore = 40/10 = 4.0
 *      → penalty: 4.0 − 1.0 = 3.0  ✓
 *
 *   B) 10 attendees, avg = 4.0 (sum=40), 2 reports, 0 friends
 *      → forced to 2.0  ✓
 *
 *   C) 10 attendees, avg = 4.0 (sum=40), 3 reports, 0 friends
 *      → forced to 1.0  ✓
 *
 *   D) 10 attendees, avg = 3.0 (sum=30), 0 reports, 3 friends
 *      → (30 + 6) / 10 = 3.6  ✓
 *
 *   E) 10 attendees, avg = 3.0 (sum=30), 0 reports, 4 friends
 *      → (30 + 8) / 10 = 3.8  ✓
 *
 *   F) 10 attendees, avg = 3.0 (sum=30), 1 report, 4 friends
 *      → friendAdjustedScore = (30 + 8) / 10 = 3.8
 *      → penalty: 3.8 − 1.0 = 2.8  ✓
 *
 *   G) 10 attendees, avg = 3.0 (sum=30), 2 reports, 4 friends (friends ignored)
 *      → forced to 2.0  ✓
 */
export function calculateEventScore(input: EventScoreInput): EventScoreResult {
  const { ratingSum, eventAttendeeCount, friendsInEvent, reportsInEvent } = input;

  if (eventAttendeeCount <= 0) {
    throw new Error("eventAttendeeCount must be greater than 0");
  }
  if (ratingSum < 0) {
    throw new Error("ratingSum cannot be negative");
  }
  if (friendsInEvent < 0 || reportsInEvent < 0) {
    throw new Error("friendsInEvent and reportsInEvent cannot be negative");
  }

  const rawBase = ratingSum / eventAttendeeCount;
  const baseScore = clamp(rawBase, MIN_SCORE, MAX_SCORE);

  // ── ≥ 3 reports: absolute floor, friends have no power ────────────────────
  if (reportsInEvent >= 3) {
    return {
      baseScore: round2(baseScore),
      friendAdjustedScore: round2(baseScore),
      finalScore: THREE_PLUS_REPORT_FORCED_SCORE,
      friendBonusApplied: false,
      appliedPenalty: "forced_one",
    };
  }

  // ── 2 reports: forced score, friends have no power ────────────────────────
  if (reportsInEvent === 2) {
    return {
      baseScore: round2(baseScore),
      friendAdjustedScore: round2(baseScore),
      finalScore: TWO_REPORT_FORCED_SCORE,
      friendBonusApplied: false,
      appliedPenalty: "forced_two",
    };
  }

  // ── 0 or 1 report: apply friend bonus ────────────────────────────────────
  const bonusPoints = friendsInEvent * FRIEND_BONUS_PER_FRIEND;
  const rawFriendAdjusted = (ratingSum + bonusPoints) / eventAttendeeCount;
  const friendAdjustedScore = clamp(rawFriendAdjusted, MIN_SCORE, MAX_SCORE);
  const friendBonusApplied = friendsInEvent > 0;

  // ── 1 report: deduct 1 from the friend-adjusted score ────────────────────
  if (reportsInEvent === 1) {
    const penalised = Math.max(MIN_SCORE, friendAdjustedScore - ONE_REPORT_DEDUCTION);
    return {
      baseScore: round2(baseScore),
      friendAdjustedScore: round2(friendAdjustedScore),
      finalScore: round2(penalised),
      friendBonusApplied,
      appliedPenalty: "minus_one",
    };
  }

  // ── 0 reports: friend-adjusted score is the final score ──────────────────
  return {
    baseScore: round2(baseScore),
    friendAdjustedScore: round2(friendAdjustedScore),
    finalScore: round2(friendAdjustedScore),
    friendBonusApplied,
    appliedPenalty: "none",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation: overall social rating from all events
// ─────────────────────────────────────────────────────────────────────────────

export interface UserEventRecord extends EventScoreInput {
  /** The event ID this record belongs to — included in the breakdown output. */
  eventId: string;
}

export interface EventBreakdownItem {
  eventId: string;
  baseScore: number;
  friendAdjustedScore: number;
  finalScore: number;
  friendBonusApplied: boolean;
  appliedPenalty: ReportPenaltyBracket;
}

export interface SocialRatingResult {
  /**
   * Average of all per-event finalScores.
   * Range: 0.00 (no events) – 5.00.
   */
  socialRating: number;

  /** Number of events contributing to this rating. */
  totalEvents: number;

  /** Human-readable label for display in the UI. */
  display: string;

  /**
   * True when totalEvents ≥ MIN_EVENTS_FOR_DISPLAY (3).
   * Only show the public rating when this is true.
   */
  hasEnoughData: boolean;

  /** Per-event score breakdown — useful for admin views and debugging. */
  breakdown: EventBreakdownItem[];
}

/**
 * Aggregates per-event adjusted scores into the user's overall social rating.
 *
 * Each event contributes one `finalScore` (computed by `calculateEventScore`).
 * The social rating is the simple average of all finalScores.
 *
 * Display rules (same as the existing system):
 * - Fewer than 3 events → "Not rated yet" (data exists internally but is not shown)
 * - 3+ events           → "★ 4.20 (7 events)"
 *
 * @param records  One record per event the user has attended/hosted, with all
 *                 required inputs pre-fetched from the DB.
 */
export function aggregateSocialRating(records: UserEventRecord[]): SocialRatingResult {
  if (records.length === 0) {
    return {
      socialRating: 0,
      totalEvents: 0,
      display: "Not rated yet",
      hasEnoughData: false,
      breakdown: [],
    };
  }

  const breakdown: EventBreakdownItem[] = records.map((r) => {
    const result = calculateEventScore(r);
    return {
      eventId: r.eventId,
      baseScore: result.baseScore,
      friendAdjustedScore: result.friendAdjustedScore,
      finalScore: result.finalScore,
      friendBonusApplied: result.friendBonusApplied,
      appliedPenalty: result.appliedPenalty,
    };
  });

  const sum = breakdown.reduce((acc, b) => acc + b.finalScore, 0);
  const socialRating = round2(sum / breakdown.length);
  const hasEnoughData = breakdown.length >= MIN_EVENTS_FOR_DISPLAY;

  const count = breakdown.length;
  const display = hasEnoughData
    ? `★ ${socialRating.toFixed(2)} (${count} ${count === 1 ? "event" : "events"})`
    : "Not rated yet";

  return {
    socialRating,
    totalEvents: count,
    display,
    hasEnoughData,
    breakdown,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
