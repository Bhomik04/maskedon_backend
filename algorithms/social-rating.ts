// Trust Level Algorithm — Pure function, no DB or HTTP imports.
// Maps a user's crowd-based social rating to a named trust level.

export interface TrustLevel {
  name: string;
  color: string;      // hex color
  min: number;
  max: number;
}

/**
 * Event-themed trust levels based on crowd rating average.
 * Ordered from lowest to highest.
 */
export const TRUST_LEVELS: TrustLevel[] = [
  { name: "Newcomer",    color: "#6B7280", min: 0,   max: 0   },
  { name: "Wallflower",  color: "#EF4444", min: 1.0, max: 1.9 },
  { name: "Drifter",     color: "#F97316", min: 2.0, max: 2.9 },
  { name: "Socialite",   color: "#EAB308", min: 3.0, max: 3.5 },
  { name: "Spark",       color: "#06B6D4", min: 3.6, max: 4.2 },
  { name: "Luminary",    color: "#8B5CF6", min: 4.3, max: 4.7 },
  { name: "Inferno",     color: "#EC4899", min: 4.8, max: 5.0 },
];

/**
 * Get the trust level for a user given their social rating and total events rated.
 */
export function getTrustLevel(socialRating: number, totalEvents: number): TrustLevel {
  if (totalEvents === 0 || socialRating === 0) {
    return TRUST_LEVELS[0]; // Newcomer
  }

  // Find the matching tier from highest to lowest
  for (let i = TRUST_LEVELS.length - 1; i >= 1; i--) {
    if (socialRating >= TRUST_LEVELS[i].min) {
      return TRUST_LEVELS[i];
    }
  }

  return TRUST_LEVELS[1]; // Wallflower (lowest non-zero)
}
