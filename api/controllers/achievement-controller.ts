import { Request, Response } from "express";
import {
  syncUserAchievements,
  getUserAchievements,
  getUserAchievementStats,
} from "../../dblayer/achievement-queries";
import { getAchievementCatalog } from "../../algorithms/achievement-rules";

// GET /api/v1/achievements/me — sync + return my unlocked achievements + stats
export async function myAchievements(req: Request, res: Response) {
  const userId = req.user!.userId;
  await syncUserAchievements(userId);
  const [unlocked, stats] = await Promise.all([
    getUserAchievements(userId),
    getUserAchievementStats(userId),
  ]);
  const catalog = getAchievementCatalog();
  const unlockedKeys = new Set(unlocked.map((a) => a.achievement_key));

  res.json({
    success: true,
    data: {
      unlocked,
      total_unlocked: unlockedKeys.size,
      total_achievements: catalog.length,
      stats,
    },
  });
}

// GET /api/v1/achievements/catalog — full list of all possible achievements
export async function catalog(_req: Request, res: Response) {
  res.json({ success: true, data: { achievements: getAchievementCatalog() } });
}

// GET /api/v1/achievements/user/:userId — public achievements of another user
export async function userAchievements(req: Request, res: Response) {
  const userId = req.params.userId as string;
  // Sync so the data is fresh
  await syncUserAchievements(userId);
  const unlocked = await getUserAchievements(userId);
  const total = getAchievementCatalog().length;
  res.json({
    success: true,
    data: {
      unlocked,
      total_unlocked: unlocked.length,
      total_achievements: total,
    },
  });
}
