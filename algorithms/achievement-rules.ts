import { getTrustLevel } from "./social-rating";

export interface AchievementUserStats {
  events_attended: number;
  events_hosted: number;
  social_rating: number;
  total_ratings: number;
  friend_count: number;
  profile_photo_count: number;
}

export interface AchievementDefinition {
  key: string;
  name: string;
  description: string;
}

interface AchievementRule extends AchievementDefinition {
  test: (stats: AchievementUserStats) => boolean;
}

const ACHIEVEMENT_RULES: AchievementRule[] = [
  { key: "first-party", name: "First Event", description: "Attend your first event", test: (s) => s.events_attended >= 1 },
  { key: "weekend-warrior", name: "Weekend Warrior", description: "Attend 5+ events", test: (s) => s.events_attended >= 5 },
  { key: "party-animal", name: "Event Animal", description: "Attend 10+ events", test: (s) => s.events_attended >= 10 },
  { key: "nightlife-legend", name: "Nightlife Legend", description: "Attend 25+ events", test: (s) => s.events_attended >= 25 },
  { key: "host-debut", name: "Host Debut", description: "Host your first event", test: (s) => s.events_hosted >= 1 },
  { key: "super-host", name: "Super Host", description: "Host 5+ events", test: (s) => s.events_hosted >= 5 },
  { key: "festival-host", name: "Festival Host", description: "Host 15+ events", test: (s) => s.events_hosted >= 15 },
  { key: "social-spark", name: "Social Spark", description: "Make 5+ friends", test: (s) => s.friend_count >= 5 },
  { key: "social-butterfly", name: "Social Butterfly", description: "Make 10+ friends", test: (s) => s.friend_count >= 10 },
  { key: "connector", name: "Connector", description: "Make 25+ friends", test: (s) => s.friend_count >= 25 },
  { key: "shutterbug", name: "Shutterbug", description: "Post 5+ profile photos", test: (s) => s.profile_photo_count >= 5 },
  { key: "gallery-master", name: "Gallery Master", description: "Post 20+ profile photos", test: (s) => s.profile_photo_count >= 20 },
  { key: "crowd-favorite", name: "Crowd Favorite", description: "Keep average rating above 4.5", test: (s) => s.total_ratings >= 3 && Number(s.social_rating) >= 4.5 },
  { key: "critic-choice", name: "Critic's Choice", description: "Keep average rating above 4.8", test: (s) => s.total_ratings >= 3 && Number(s.social_rating) >= 4.8 },
  {
    key: "trusted",
    name: "Trusted",
    description: "Reach Spark trust level",
    test: (s) => ["Spark", "Luminary", "Inferno"].includes(getTrustLevel(Number(s.social_rating), s.total_ratings).name),
  },
  {
    key: "legendary-trust",
    name: "Legendary Trust",
    description: "Reach Luminary or Inferno",
    test: (s) => ["Luminary", "Inferno"].includes(getTrustLevel(Number(s.social_rating), s.total_ratings).name),
  },
  {
    key: "all-rounder",
    name: "All-Rounder",
    description: "Host 5+, attend 10+, make 10+ friends, post 5+ photos",
    test: (s) => s.events_hosted >= 5 && s.events_attended >= 10 && s.friend_count >= 10 && s.profile_photo_count >= 5,
  },
];

export function getAchievementCatalog(): AchievementDefinition[] {
  return ACHIEVEMENT_RULES.map(({ key, name, description }) => ({ key, name, description }));
}

export function evaluateUnlockedAchievements(stats: AchievementUserStats): AchievementDefinition[] {
  return ACHIEVEMENT_RULES.filter((rule) => rule.test(stats)).map(({ key, name, description }) => ({
    key,
    name,
    description,
  }));
}
