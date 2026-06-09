import { query, getConnection } from "./connection";
import { v4 as uuidv4 } from "uuid";

// ============================================
// PHOTO TYPES
// ============================================

export interface PhotoRow {
  id: string;
  user_id: string;
  event_id: string | null;
  image_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  like_count: number;
  view_count: number;
  global_visibility: boolean;
  friends_only: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  liked_by_me?: boolean;
}

export interface PhotoWithUser extends PhotoRow {
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface PhotoLikeRow {
  id: string;
  photo_id: string;
  user_id: string;
  created_at: Date;
}

export interface PhotoCommentRow {
  id: string;
  photo_id: string;
  user_id: string;
  comment_text: string;
  like_count: number;
  parent_comment_id: string | null;
  is_pinned: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface PhotoCommentWithUser extends PhotoCommentRow {
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface PhotoCommentWithReplies extends PhotoCommentWithUser {
  replies: PhotoCommentWithUser[];
}

// ============================================
// PHOTO QUERIES
// ============================================

export async function createPhoto(
  userId: string,
  imageUrl: string,
  thumbnailUrl: string | null,
  eventId?: string,
  caption?: string,
  globalVisibility: boolean = false,
  friendsOnly: boolean = false
): Promise<PhotoRow> {
  const id = uuidv4();
  await query(
    `INSERT INTO photos (id, user_id, event_id, image_url, thumbnail_url, caption, global_visibility, friends_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, eventId || null, imageUrl, thumbnailUrl, caption || null, globalVisibility, friendsOnly]
  );

  // Extract tags from caption for interest-matching (words starting with # or known keywords)
  // Only index globally-visible, non-private posts
  if (globalVisibility && !friendsOnly && caption) {
    const tags = extractTagsFromCaption(caption);
    if (tags.length > 0) {
      const placeholders = tags.map(() => "(?, ?)").join(", ");
      const values = tags.flatMap((tag) => [id, tag]);
      await query(
        `INSERT INTO photo_tags (photo_id, tag) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        values
      );
    }
  }

  const result = await query<PhotoRow>("SELECT * FROM photos WHERE id = ?", [id]);
  return result.rows[0]!;
}

/**
 * Extract interest tags from a caption.
 * Pulls explicit #hashtags and common event/vibe keywords.
 */
export function extractTagsFromCaption(caption: string): string[] {
  const tags = new Set<string>();
  // Explicit hashtags
  const hashMatches = caption.match(/#([a-zA-Z0-9_]{2,30})/g) || [];
  for (const h of hashMatches) tags.add(h.slice(1).toLowerCase());
  // Known vibe keywords present in caption text
  const VIBE_KEYWORDS = [
    "rooftop","underground","techno","hiphop","hip-hop","lounge","pool","brunch",
    "sunset","warehouse","luxury","themed","halloween","bollywood","indie",
    "livemusic","acoustic","garden","beach","event","nightlife","rave","festival",
  ];
  const lower = caption.toLowerCase();
  for (const kw of VIBE_KEYWORDS) {
    if (lower.includes(kw)) tags.add(kw);
  }
  return Array.from(tags).slice(0, 15);
}

export async function findPhotoById(id: string): Promise<PhotoRow | null> {
  const result = await query<PhotoRow>(
    "SELECT * FROM photos WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  return result.rows[0] || null;
}

export async function deletePhoto(id: string): Promise<void> {
  await query("UPDATE photos SET deleted_at = NOW() WHERE id = ?", [id]);
}

export async function getEventPhotos(
  eventId: string,
  page = 1,
  limit = 20,
  viewerUserId?: string
): Promise<{ photos: PhotoWithUser[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM photos WHERE event_id = ? AND deleted_at IS NULL",
    [eventId]
  );
  const total = countResult.rows[0]?.cnt || 0;

  if (viewerUserId) {
    const result = await query<PhotoWithUser & { liked_by_me: boolean }>(
      `SELECT p.*, u.username, u.display_name, u.avatar_url,
              CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me
       FROM photos p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
       WHERE p.event_id = ? AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [viewerUserId, eventId, limit, offset]
    );
    const photos = result.rows.map((row) => ({ ...row, liked_by_me: Boolean(row.liked_by_me) }));
    return { photos, total };
  }

  const result = await query<PhotoWithUser>(
    `SELECT p.*, u.username, u.display_name, u.avatar_url
     FROM photos p
     JOIN users u ON u.id = p.user_id
     WHERE p.event_id = ? AND p.deleted_at IS NULL
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [eventId, limit, offset]
  );
  return { photos: result.rows, total };
}

export async function getUserPhotos(
  userId: string,
  page = 1,
  limit = 20,
  viewerUserId?: string // undefined = unauthenticated, same as userId = own profile
): Promise<{ photos: PhotoRow[]; total: number }> {
  const offset = (page - 1) * limit;
  const isOwner = viewerUserId === userId;

  // Owners see all their photos.
  // Non-owners see only publicly visible photos (global_visibility = TRUE).
  // friends_only posts are intentionally excluded here — the feed handles them separately.
  const visibilityClause = isOwner
    ? ""
    : "AND p.global_visibility = TRUE";

  const countResult = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM photos p WHERE p.user_id = ? AND p.deleted_at IS NULL ${visibilityClause}`,
    [userId]
  );
  const total = countResult.rows[0]?.cnt || 0;

  // If we have a viewer, join with photo_likes to determine liked_by_me
  if (viewerUserId) {
    const result = await query<PhotoRow & { liked_by_me: boolean }>(
      `SELECT p.*,
              CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me
       FROM photos p
       LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
       WHERE p.user_id = ? AND p.deleted_at IS NULL ${visibilityClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [viewerUserId, userId, limit, offset]
    );
    const photos = result.rows.map((row) => ({ ...row, liked_by_me: Boolean(row.liked_by_me) }));
    return { photos, total };
  }

  const result = await query<PhotoRow>(
    `SELECT p.* FROM photos p
     WHERE p.user_id = ? AND p.deleted_at IS NULL ${visibilityClause}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return { photos: result.rows, total };
}

// ============================================
// PHOTO LIKE QUERIES
// ============================================

export async function likePhoto(photoId: string, userId: string): Promise<void> {
  const id = uuidv4();
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "INSERT INTO photo_likes (id, photo_id, user_id) VALUES (?, ?, ?)",
      [id, photoId, userId]
    );
    await conn.execute(
      "UPDATE photos SET like_count = like_count + 1 WHERE id = ?",
      [photoId]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function unlikePhoto(photoId: string, userId: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "DELETE FROM photo_likes WHERE photo_id = ? AND user_id = ?",
      [photoId, userId]
    ) as [{ affectedRows: number }];
    if (result.affectedRows > 0) {
      await conn.execute(
        "UPDATE photos SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?",
        [photoId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function findPhotoLike(
  photoId: string,
  userId: string
): Promise<PhotoLikeRow | null> {
  const result = await query<PhotoLikeRow>(
    "SELECT * FROM photo_likes WHERE photo_id = ? AND user_id = ?",
    [photoId, userId]
  );
  return result.rows[0] || null;
}

export interface PhotoLikerUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  liked_at: Date;
}

export async function getPhotoLikers(
  photoId: string,
  page = 1,
  limit = 30
): Promise<{ likers: PhotoLikerUser[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM photo_likes WHERE photo_id = ?",
    [photoId]
  );
  const total = countResult.rows[0]?.cnt || 0;

  const result = await query<PhotoLikerUser>(
    `SELECT pl.user_id, u.username, u.display_name, u.avatar_url, pl.created_at AS liked_at
     FROM photo_likes pl
     JOIN users u ON u.id = pl.user_id
     WHERE pl.photo_id = ?
     ORDER BY pl.created_at DESC
     LIMIT ? OFFSET ?`,
    [photoId, limit, offset]
  );

  return { likers: result.rows, total };
}

// ============================================
// PHOTO COMMENT QUERIES
// ============================================

export async function createComment(
  photoId: string,
  userId: string,
  commentText: string,
  parentCommentId?: string | null
): Promise<PhotoCommentWithUser> {
  const id = uuidv4();
  await query(
    `INSERT INTO photo_comments (id, photo_id, user_id, comment_text, parent_comment_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, photoId, userId, commentText, parentCommentId ?? null]
  );
  const result = await query<PhotoCommentWithUser>(
    `SELECT c.*, u.username, u.display_name, u.avatar_url
     FROM photo_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = ?`,
    [id]
  );
  return result.rows[0]!;
}

export async function findCommentById(id: string): Promise<PhotoCommentRow | null> {
  const result = await query<PhotoCommentRow>(
    "SELECT * FROM photo_comments WHERE id = ? AND deleted_at IS NULL",
    [id]
  );
  return result.rows[0] || null;
}

export async function deleteComment(id: string): Promise<void> {
  await query("UPDATE photo_comments SET deleted_at = NOW() WHERE id = ?", [id]);
}

export async function updateComment(id: string, commentText: string): Promise<PhotoCommentRow | null> {
  await query(
    "UPDATE photo_comments SET comment_text = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [commentText, id]
  );
  return findCommentById(id);
}

export async function getPhotoComments(
  photoId: string,
  page = 1,
  limit = 20
): Promise<{ comments: PhotoCommentWithReplies[]; total: number }> {
  const offset = (page - 1) * limit;

  // Count only top-level comments for pagination
  const countResult = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM photo_comments WHERE photo_id = ? AND parent_comment_id IS NULL AND deleted_at IS NULL",
    [photoId]
  );
  const total = Number(countResult.rows[0]?.cnt ?? 0);

  // Fetch paginated top-level comments, pinned first then newest
  const topLevel = await query<PhotoCommentWithUser>(
    `SELECT c.*, u.username, u.display_name, u.avatar_url
     FROM photo_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.photo_id = ? AND c.parent_comment_id IS NULL AND c.deleted_at IS NULL
     ORDER BY c.is_pinned DESC, c.created_at DESC
     LIMIT ? OFFSET ?`,
    [photoId, limit, offset]
  );

  if (topLevel.rows.length === 0) return { comments: [], total };

  // Fetch all replies for the fetched top-level comments in one query
  const topIds = topLevel.rows.map((c) => c.id);
  const placeholders = topIds.map(() => "?").join(",");
  const replies = await query<PhotoCommentWithUser>(
    `SELECT c.*, u.username, u.display_name, u.avatar_url
     FROM photo_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.parent_comment_id IN (${placeholders}) AND c.deleted_at IS NULL
     ORDER BY c.created_at ASC`,
    topIds
  );

  // Group replies under their parent
  const replyMap = new Map<string, PhotoCommentWithUser[]>();
  for (const reply of replies.rows) {
    const pid = reply.parent_comment_id!;
    if (!replyMap.has(pid)) replyMap.set(pid, []);
    replyMap.get(pid)!.push(reply);
  }

  const comments: PhotoCommentWithReplies[] = topLevel.rows.map((c) => ({
    ...c,
    replies: replyMap.get(c.id) ?? [],
  }));

  return { comments, total };
}

export async function pinComment(
  commentId: string
): Promise<void> {
  await query(
    "UPDATE photo_comments SET is_pinned = TRUE, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [commentId]
  );
}

export async function unpinComment(
  commentId: string
): Promise<void> {
  await query(
    "UPDATE photo_comments SET is_pinned = FALSE, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [commentId]
  );
}

// ============================================
// PHOTO CAPTION UPDATE
// ============================================

export async function updatePhotoCaption(photoId: string, caption: string | null): Promise<PhotoRow | null> {
  await query(
    "UPDATE photos SET caption = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [caption, photoId]
  );
  return findPhotoById(photoId);
}

// ============================================
// PHOTO VIEW QUERIES
// ============================================

export interface PhotoViewRow {
  id: string;
  photo_id: string;
  user_id: string;
  created_at: Date;
}

export async function recordPhotoView(photoId: string, userId: string): Promise<boolean> {
  // INSERT on conflict do nothing — only counts unique views
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO photo_views (id, photo_id, user_id)
       VALUES (?, ?, ?)
       ON CONFLICT (photo_id, user_id) DO NOTHING`,
      [uuidv4(), photoId, userId]
    ) as [{ affectedRows: number }];
    if (result.affectedRows > 0) {
      await conn.execute("UPDATE photos SET view_count = view_count + 1 WHERE id = ?", [photoId]);
      await conn.commit();
      return true; // new view
    }
    await conn.commit();
    return false; // already viewed
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getPhotoViewCount(photoId: string): Promise<number> {
  const result = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM photo_views WHERE photo_id = ?",
    [photoId]
  );
  return result.rows[0]?.cnt || 0;
}

export async function getPhotoInsights(photoId: string): Promise<{
  view_count: number;
  like_count: number;
  comment_count: number;
}> {
  const viewResult = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM photo_views WHERE photo_id = ?",
    [photoId]
  );
  const photo = await findPhotoById(photoId);
  const commentResult = await query<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM photo_comments WHERE photo_id = ? AND deleted_at IS NULL",
    [photoId]
  );
  return {
    view_count: viewResult.rows[0]?.cnt || 0,
    like_count: photo?.like_count || 0,
    comment_count: commentResult.rows[0]?.cnt || 0,
  };
}

/**
 * Batch record views for multiple photos at once.
 * Used when a user scrolls through a feed.
 */
export async function recordPhotoViewsBatch(photoIds: string[], userId: string): Promise<number> {
  let newViews = 0;
  for (const photoId of photoIds) {
    const isNew = await recordPhotoView(photoId, userId);
    if (isNew) newViews++;
  }
  return newViews;
}

// ============================================
// PHOTO SAVES
// ============================================

export interface PhotoSaveRow {
  id: string;
  photo_id: string;
  user_id: string;
  created_at: Date;
}

export async function savePhoto(photoId: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO photo_saves (photo_id, user_id) VALUES (?, ?)
     ON CONFLICT (photo_id, user_id) DO NOTHING`,
    [photoId, userId]
  );
}

export async function unsavePhoto(photoId: string, userId: string): Promise<void> {
  await query(
    "DELETE FROM photo_saves WHERE photo_id = ? AND user_id = ?",
    [photoId, userId]
  );
}

export async function findPhotoSave(
  photoId: string,
  userId: string
): Promise<PhotoSaveRow | null> {
  const result = await query<PhotoSaveRow>(
    "SELECT * FROM photo_saves WHERE photo_id = ? AND user_id = ?",
    [photoId, userId]
  );
  return result.rows[0] || null;
}

export async function getSavedPhotos(
  userId: string,
  limit = 20,
  offset = 0
): Promise<PhotoWithUser[]> {
  const result = await query<PhotoWithUser & { liked_by_me: boolean }>(
    `SELECT p.*, u.username, u.display_name, u.avatar_url,
            CASE WHEN pl.id IS NOT NULL THEN TRUE ELSE FALSE END AS liked_by_me
     FROM photo_saves ps
     JOIN photos p ON ps.photo_id = p.id
     JOIN users u ON p.user_id = u.id
     LEFT JOIN photo_likes pl ON pl.photo_id = p.id AND pl.user_id = ?
     WHERE ps.user_id = ? AND p.deleted_at IS NULL
     ORDER BY ps.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, userId, limit, offset]
  );
  return result.rows.map((row) => ({ ...row, liked_by_me: Boolean(row.liked_by_me) }));
}
