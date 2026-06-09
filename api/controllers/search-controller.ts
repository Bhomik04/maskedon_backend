import { Request, Response } from "express";
import { searchUsers } from "../../dblayer/user-queries";
import { searchAllEvents } from "../../dblayer/event-queries";

function parseEventTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) {
        return parsed.filter((tag): tag is string => typeof tag === "string");
      }
    } catch {
      return [];
    }
  }

  return [];
}

// GET /api/v1/search?q=&limit=
export async function universalSearch(req: Request, res: Response) {
  const q = ((req.query.q as string) || "").trim();

  if (q.length > 200) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Search query must be 200 characters or fewer" },
    });
    return;
  }

  if (q.length < 2) {
    res.json({ success: true, data: { users: [], events: [], query: q } });
    return;
  }

  const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) || "8", 10), 20));

  const [users, events] = await Promise.all([
    searchUsers(q, limit),
    searchAllEvents(q, limit),
  ]);

  const normalizedEvents = events.map((event) => ({
    ...event,
    tags: parseEventTags(event.tags),
  }));

  res.json({ success: true, data: { users, events: normalizedEvents, query: q } });
}
