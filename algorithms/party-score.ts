// Party Score Algorithm — Pure function, no DB or HTTP imports.
//
// Calculates each individual user's adjusted score for a specific party,
// layering two modifiers on top of the raw crowd average:
//   1. Friend Bonus   — rewarded for having friends in the party
//   2. Report Penalty — penalised for being reported during the party
//
// This per-party score then feeds into the user's overall social rating
// (averaged across all parties they have attended or hosted).

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
 * Score forced when the user receives exactly 2 reports in this party.
 * Friends bonus is ignored when this bracket is reached.
 */
const TWO_REPORT_FORCED_SCORE = 2.0;

/**
 * Score forced when the user receives 3 or more reports in this party.
 * Friends bonus is ignored when this bracket is reached.
 */
const THREE_PLUS_REPORT_FORCED_SCORE = 1.0;

/** Stars deducted from the friend-adjusted score when exactly 1 report is filed. */
const ONE_REPORT_DEDUCTION = 1.0;

/** Minimum parties a user must have attended before their rating is shown publicly. */
const MIN_PARTIES_FOR_DISPLAY = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface PartyScoreInput {
  /**
   * Sum of all crowd rating scores submitted for this party.
   * Example: 10 people each gave 3 stars → ratingSum = 30.
   */
  ratingSum: number;

  /**
   * Total number of attendees in the party.
   * Used as the denominator for both the base average and the friend bonus.
   * Must be ≥ 1.
   */
  partyAttendeeCount: number;

  /**
   * Number of accepted friends this user has among the party attendees.
   * Used to compute the friend bonus added to the numerator.
   *
   * DB note: query friendships where status = 'accepted' AND
   *   (requester_id = userId OR addressee_id = userId)
   *   AND the other user is in party_attendees for this party.
   */
  friendsInParty: number;

  /**
   * Number of reports filed against this user within the context of this party.
   * Only "open" or "reviewed" reports should count (not dismissed ones).
   *
   * DB note: a `party_id` column should be added to the reports table to scope
   * reports to a specific party. Until then, use reports where target_type = 'user'
   * AND target_id = userId AND the report was created within the party's time window.
   */
  reportsInParty: number;
}

/** Which report penalty bracket was triggered. */
export type ReportPenaltyBracket =
  | "none"       // 0 reports — no penalty
  | "minus_one"  // 1 report  — friends bonus applied, then −1 deducted
  | "forced_two" // 2 reports — score forced to 2.0, friends ignored
  | "forced_one" // ≥3 reports — score forced to 1.0, friends ignored

export interface PartyScoreResult {
  /** Raw party average: ratingSum / partyAttendeeCount. Clamped to [1.0, 5.0]. */
  baseScore: number;

  /**
   * Score after applying the friend bonus (before any report penalty).
   * Equal to baseScore when friendsInParty = 0, or when reports > 1 (bonus skipped).
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
// Core: per-party score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates the adjusted party score for a single user.
 *
 * ── Step 1: Base average ────────────────────────────────────────────────────
 *   baseScore = ratingSum / partyAttendeeCount
 *
 * ── Step 2: Friend bonus ────────────────────────────────────────────────────
 *   Applied only when reportsInParty ≤ 1 (reports override friends when > 1).
 *
 *   bonusPoints = friendsInParty × 2
 *   friendAdjustedScore = (ratingSum + bonusPoints) / partyAttendeeCount
 *   → Capped at 5.0
 *
 * ── Step 3: Report penalty ──────────────────────────────────────────────────
 *
 *   reportsInParty │ Rule
 *   ───────────────┼──────────────────────────────────────────────────────────
 *        0         │ friendAdjustedScore is the final score (capped at 5.0)
 *        1         │ friendAdjustedScore − 1.0, minimum 1.0
 *        2         │ Forced to 2.0 regardless of party avg or friends
 *       ≥ 3        │ Forced to 1.0 regardless of party avg or friends
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
export function calculatePartyScore(input: PartyScoreInput): PartyScoreResult {
  const { ratingSum, partyAttendeeCount, friendsInParty, reportsInParty } = input;

  if (partyAttendeeCount <= 0) {
    throw new Error("partyAttendeeCount must be greater than 0");
  }
  if (ratingSum < 0) {
    throw new Error("ratingSum cannot be negative");
  }
  if (friendsInParty < 0 || reportsInParty < 0) {
    throw new Error("friendsInParty and reportsInParty cannot be negative");
  }

  const rawBase = ratingSum / partyAttendeeCount;
  const baseScore = clamp(rawBase, MIN_SCORE, MAX_SCORE);

  // ── ≥ 3 reports: absolute floor, friends have no power ────────────────────
  if (reportsInParty >= 3) {
    return {
      baseScore: round2(baseScore),
      friendAdjustedScore: round2(baseScore),
      finalScore: THREE_PLUS_REPORT_FORCED_SCORE,
      friendBonusApplied: false,
      appliedPenalty: "forced_one",
    };
  }

  // ── 2 reports: forced score, friends have no power ────────────────────────
  if (reportsInParty === 2) {
    return {
      baseScore: round2(baseScore),
      friendAdjustedScore: round2(baseScore),
      finalScore: TWO_REPORT_FORCED_SCORE,
      friendBonusApplied: false,
      appliedPenalty: "forced_two",
    };
  }

  // ── 0 or 1 report: apply friend bonus ────────────────────────────────────
  const bonusPoints = friendsInParty * FRIEND_BONUS_PER_FRIEND;
  const rawFriendAdjusted = (ratingSum + bonusPoints) / partyAttendeeCount;
  const friendAdjustedScore = clamp(rawFriendAdjusted, MIN_SCORE, MAX_SCORE);
  const friendBonusApplied = friendsInParty > 0;

  // ── 1 report: deduct 1 from the friend-adjusted score ────────────────────
  if (reportsInParty === 1) {
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
// Aggregation: overall social rating from all parties
// ─────────────────────────────────────────────────────────────────────────────

export interface UserPartyRecord extends PartyScoreInput {
  /** The party ID this record belongs to — included in the breakdown output. */
  partyId: string;
}

export interface PartyBreakdownItem {
  partyId: string;
  baseScore: number;
  friendAdjustedScore: number;
  finalScore: number;
  friendBonusApplied: boolean;
  appliedPenalty: ReportPenaltyBracket;
}

export interface SocialRatingResult {
  /**
   * Average of all per-party finalScores.
   * Range: 0.00 (no parties) – 5.00.
   */
  socialRating: number;

  /** Number of parties contributing to this rating. */
  totalParties: number;

  /** Human-readable label for display in the UI. */
  display: string;

  /**
   * True when totalParties ≥ MIN_PARTIES_FOR_DISPLAY (3).
   * Only show the public rating when this is true.
   */
  hasEnoughData: boolean;

  /** Per-party score breakdown — useful for admin views and debugging. */
  breakdown: PartyBreakdownItem[];
}

/**
 * Aggregates per-party adjusted scores into the user's overall social rating.
 *
 * Each party contributes one `finalScore` (computed by `calculatePartyScore`).
 * The social rating is the simple average of all finalScores.
 *
 * Display rules (same as the existing system):
 * - Fewer than 3 parties → "Not rated yet" (data exists internally but is not shown)
 * - 3+ parties           → "★ 4.20 (7 parties)"
 *
 * @param records  One record per party the user has attended/hosted, with all
 *                 required inputs pre-fetched from the DB.
 */
export function aggregateSocialRating(records: UserPartyRecord[]): SocialRatingResult {
  if (records.length === 0) {
    return {
      socialRating: 0,
      totalParties: 0,
      display: "Not rated yet",
      hasEnoughData: false,
      breakdown: [],
    };
  }

  const breakdown: PartyBreakdownItem[] = records.map((r) => {
    const result = calculatePartyScore(r);
    return {
      partyId: r.partyId,
      baseScore: result.baseScore,
      friendAdjustedScore: result.friendAdjustedScore,
      finalScore: result.finalScore,
      friendBonusApplied: result.friendBonusApplied,
      appliedPenalty: result.appliedPenalty,
    };
  });

  const sum = breakdown.reduce((acc, b) => acc + b.finalScore, 0);
  const socialRating = round2(sum / breakdown.length);
  const hasEnoughData = breakdown.length >= MIN_PARTIES_FOR_DISPLAY;

  const count = breakdown.length;
  const display = hasEnoughData
    ? `★ ${socialRating.toFixed(2)} (${count} ${count === 1 ? "party" : "parties"})`
    : "Not rated yet";

  return {
    socialRating,
    totalParties: count,
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
