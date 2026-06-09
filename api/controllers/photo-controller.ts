import { Request, Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import { uploadPhotoSchema, addCommentSchema, editCommentSchema, editCaptionSchema } from "../validators/photo-validators";
import {
  createPhoto,
  findPhotoById,
  deletePhoto,
  getEventPhotos,
  getUserPhotos,
  likePhoto,
  unlikePhoto,
  findPhotoLike,
  getPhotoLikers,
  savePhoto,
  unsavePhoto,
  findPhotoSave,
  getSavedPhotos,
  createComment,
  findCommentById,
  deleteComment,
  updateComment,
  getPhotoComments,
  pinComment,
  unpinComment,
  updatePhotoCaption,
  recordPhotoView,
  recordPhotoViewsBatch,
  getPhotoInsights,
} from "../../dblayer/photo-queries";
import { findEventById } from "../../dblayer/event-queries";
import { findAttendee } from "../../dblayer/payment-queries";
import { createNotificationWithSocket } from "../../dblayer/notification-queries";
import { uploadToStorage, deleteFromStorage } from "../lib/supabase";
import {
  compressImage,
  detectImageMimeFromMagic,
  extensionForMime,
  MAX_STORED_IMAGE_SIZE,
  SUPPORTED_MIMES,
} from "../../algorithms/image-compression";

const MAX_UPLOAD_FILE_SIZE = parseInt(process.env.MAX_PHOTO_UPLOAD_SIZE || "20971520", 10);
const ALLOWED_MIMES: string[] = [...SUPPORTED_MIMES];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// POST /api/v1/photos
export async function uploadPhoto(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: { code: "NO_FILE", message: "Image file is required" },
    });
    return;
  }

  const detectedMime = detectImageMimeFromMagic(req.file.buffer);
  if (!detectedMime || !ALLOWED_MIMES.includes(detectedMime)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_FILE_TYPE", message: "Only valid JPEG, PNG, and WebP images are allowed" },
    });
    return;
  }

  const userId = req.user!.userId;

  const parsed = uploadPhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { event_id, caption, global_visibility, friends_only } = parsed.data;

  // Profile photos (event_id = null) are always scoped to the authenticated user.
  // The uploader_id is unconditionally set to req.user!.userId below, so no other
  // user can inject a photo onto someone else's profile regardless of request body.
  if (!event_id && req.body.user_id && req.body.user_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Cannot upload a profile photo on behalf of another user" },
    });
    return;
  }

  // If tagging to a event, validate access
  if (event_id) {
    const event = await findEventById(event_id);
    if (!event) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Event not found" },
      });
      return;
    }

    if (event.status !== "ongoing" && event.status !== "completed") {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_STATE", message: "Can only upload photos for ongoing or completed events" },
      });
      return;
    }

    // Must be attendee or host
    const isHost = event.host_id === userId;
    const attendee = isHost ? true : await findAttendee(event_id, userId);
    if (!attendee) {
      res.status(403).json({
        success: false,
        error: { code: "NOT_ATTENDEE", message: "Only attendees can upload photos to this event" },
      });
      return;
    }

    // Respect the event's allow_photos flag (H-9)
    if (!event.allow_photos && !isHost) {
      res.status(403).json({
        success: false,
        error: { code: "PHOTOS_DISABLED", message: "The host has disabled photo uploads for this event" },
      });
      return;
    }
  }

  const compressionResult = await compressImage({
    buffer: req.file.buffer,
    detectedMime,
  });
  if (compressionResult.finalSize > MAX_STORED_IMAGE_SIZE) {
    res.status(413).json({
      success: false,
      error: {
        code: "IMAGE_TOO_LARGE",
        message: "Image is too large to store. Please upload an image under 15 MB or lower the resolution.",
      },
    });
    return;
  }

  const storageBuffer = compressionResult.buffer;
  const storageMime = compressionResult.mime;

  // Upload full-resolution image to Supabase Storage using UUID-based filename
  const ext = extensionForMime(storageMime);
  const photoId = uuidv4();
  const safeName = `${photoId}${ext}`;
  const imageUrl = await uploadToStorage("photos", storageBuffer, safeName, storageMime);

  // Generate and upload thumbnail (max 400×400, JPEG quality 80)
  const thumbBuffer = await sharp(storageBuffer)
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const thumbName = `thumb_${photoId}.jpg`;
  const thumbnailUrl = await uploadToStorage("photos", thumbBuffer, thumbName, "image/jpeg");

  const photo = await createPhoto(userId, imageUrl, thumbnailUrl, event_id, caption, global_visibility ?? false, friends_only ?? false);
  res.status(201).json({ success: true, data: { photo } });
}

// GET /api/v1/photos/:photoId
export async function getPhoto(req: Request, res: Response) {
  const photo = await findPhotoById(req.params.photoId as string);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  const viewerId = req.user?.userId;
  const isOwner = viewerId === photo.user_id;

  // Enforce visibility for non-owners (H-10)
  if (!isOwner) {
    if (!photo.global_visibility) {
      // Photo is private or friends-only — non-owners cannot access it directly
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "You do not have permission to view this photo" },
      });
      return;
    }
  }

  // Check if current user has liked
  const liked = viewerId ? !!(await findPhotoLike(photo.id, viewerId)) : false;

  res.json({ success: true, data: { photo, liked } });
}

// DELETE /api/v1/photos/:photoId
export async function removePhoto(req: Request, res: Response) {
  const photo = await findPhotoById(req.params.photoId as string);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  if (photo.user_id !== req.user!.userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "You can only delete your own photos" },
    });
    return;
  }

  // Delete both full-resolution and thumbnail from Supabase Storage (M-7)
  deleteFromStorage("photos", photo.image_url).catch(() => {});
  if (photo.thumbnail_url) {
    deleteFromStorage("photos", photo.thumbnail_url).catch(() => {});
  }

  await deletePhoto(photo.id);
  res.json({ success: true, data: { message: "Photo deleted" } });
}

// POST /api/v1/photos/:photoId/like
export async function like(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  const existing = await findPhotoLike(photoId, userId);
  if (existing) {
    res.status(409).json({
      success: false,
      error: { code: "ALREADY_LIKED", message: "You already liked this photo" },
    });
    return;
  }

  await likePhoto(photoId, userId);

  // Notify photo owner (if not self-like)
  if (photo.user_id !== userId) {
    createNotificationWithSocket(
      photo.user_id,
      "photo_liked",
      "Photo liked",
      "Someone liked your photo",
      photoId,
      "photo"
    ).catch(() => {});
  }

  res.json({ success: true, data: { message: "Photo liked" } });
}

// DELETE /api/v1/photos/:photoId/like
export async function unlike(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  const existing = await findPhotoLike(photoId, userId);
  if (!existing) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_LIKED", message: "You haven't liked this photo" },
    });
    return;
  }

  await unlikePhoto(photoId, userId);
  res.json({ success: true, data: { message: "Photo unliked" } });
}

// GET /api/v1/photos/:photoId/likes
export async function listPhotoLikers(req: Request, res: Response) {
  const photoId = req.params.photoId as string;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string, 10) || 30));
  const result = await getPhotoLikers(photoId, page, limit);
  res.json({ success: true, data: result });
}

// GET /api/v1/events/:eventId/photos
export async function listEventPhotos(req: Request, res: Response) {
  const eventId = req.params.eventId as string;
  const userId = req.user!.userId;
  const event = await findEventById(eventId);
  if (!event) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Event not found" },
    });
    return;
  }

  // Only the host or confirmed attendees may view event photos (H-11)
  const isHost = event.host_id === userId;
  if (!isHost) {
    const attendee = await findAttendee(eventId, userId);
    if (!attendee) {
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "Only the host or attendees can view event photos" },
      });
      return;
    }
  }

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string, 10) || 20));
  const result = await getEventPhotos(eventId, page, limit, userId);
  res.json({ success: true, data: result });
}

// GET /api/v1/users/:userId/photos
export async function listUserPhotos(req: Request, res: Response) {
  const userId = req.params.userId as string;
  const viewerUserId = req.user?.userId;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string, 10) || 20));
  const result = await getUserPhotos(userId, page, limit, viewerUserId);
  res.json({ success: true, data: result });
}

// ============================================
// PHOTO COMMENT ENDPOINTS
// ============================================

// POST /api/v1/photos/:photoId/comments
export async function addComment(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const parsed = addCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { comment_text, parent_comment_id } = parsed.data;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  // If this is a reply, validate the parent comment belongs to the same photo
  if (parent_comment_id) {
    const parent = await findCommentById(parent_comment_id);
    if (!parent || parent.photo_id !== photoId) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_PARENT", message: "Parent comment not found on this photo" },
      });
      return;
    }
    // Prevent nested replies (replies-to-replies) — Instagram-style 1-level deep
    if (parent.parent_comment_id !== null) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_PARENT", message: "Replies cannot be nested more than one level" },
      });
      return;
    }
  }

  const comment = await createComment(photoId, userId, comment_text.trim(), parent_comment_id ?? null);

  // Notify photo owner (if not self-comment)
  if (photo.user_id !== userId) {
    createNotificationWithSocket(
      photo.user_id,
      "photo_commented",
      "New comment on your photo",
      `Someone commented on your photo`,
      photoId,
      "photo"
    ).catch(() => {});
  }

  res.status(201).json({ success: true, data: { comment } });
}

// GET /api/v1/photos/:photoId/comments
export async function listPhotoComments(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit as string, 10) || 20));

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  const result = await getPhotoComments(photoId, page, limit);
  res.json({ success: true, data: result });
}

// PUT /api/v1/photos/comments/:commentId
export async function editComment(req: Request, res: Response) {
  const commentId = req.params.commentId as string;
  const userId = req.user!.userId;

  const parsed = editCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { comment_text } = parsed.data;

  const comment = await findCommentById(commentId);
  if (!comment) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Comment not found" },
    });
    return;
  }

  if (comment.user_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "You can only edit your own comments" },
    });
    return;
  }

  const updated = await updateComment(commentId, comment_text.trim());
  res.json({ success: true, data: { comment: updated } });
}

// DELETE /api/v1/photos/comments/:commentId
export async function removeComment(req: Request, res: Response) {
  const commentId = req.params.commentId as string;
  const userId = req.user!.userId;

  const comment = await findCommentById(commentId);
  if (!comment) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Comment not found" },
    });
    return;
  }

  if (comment.user_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "You can only delete your own comments" },
    });
    return;
  }

  await deleteComment(commentId);
  res.json({ success: true, data: { message: "Comment deleted" } });
}

// PATCH /api/v1/photos/comments/:commentId/pin
export async function togglePinComment(req: Request, res: Response) {
  const commentId = req.params.commentId as string;
  const userId = req.user!.userId;

  const comment = await findCommentById(commentId);
  if (!comment) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Comment not found" },
    });
    return;
  }

  // Only photo owner can pin/unpin
  const photo = await findPhotoById(comment.photo_id);
  if (!photo || photo.user_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the photo owner can pin comments" },
    });
    return;
  }

  // Only top-level comments can be pinned
  if (comment.parent_comment_id !== null) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_COMMENT", message: "Replies cannot be pinned" },
    });
    return;
  }

  if (comment.is_pinned) {
    await unpinComment(commentId);
    res.json({ success: true, data: { pinned: false } });
  } else {
    await pinComment(commentId);
    res.json({ success: true, data: { pinned: true } });
  }
}

// ============================================
// CAPTION EDIT
// ============================================

// PATCH /api/v1/photos/:photoId/caption
export async function editCaption(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const parsed = editCaptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  if (photo.user_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "You can only edit your own photos" },
    });
    return;
  }

  const updated = await updatePhotoCaption(photoId, parsed.data.caption?.trim() || null);
  res.json({ success: true, data: { photo: updated } });
}

// ============================================
// PHOTO VIEWS
// ============================================

// POST /api/v1/photos/:photoId/view
export async function recordView(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  const isNew = await recordPhotoView(photoId, userId);
  res.json({ success: true, data: { new_view: isNew } });
}

// POST /api/v1/photos/views/batch
export async function recordViewsBatch(req: Request, res: Response) {
  const userId = req.user!.userId;
  const { photo_ids } = req.body;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!Array.isArray(photo_ids) || photo_ids.length === 0 || photo_ids.length > 50 || !photo_ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "photo_ids must be an array of 1-50 UUIDs" },
    });
    return;
  }

  // Deduplicate to prevent inflated view counts from duplicate IDs (M-8)
  const uniquePhotoIds = [...new Set(photo_ids as string[])];

  const newViews = await recordPhotoViewsBatch(uniquePhotoIds, userId);
  res.json({ success: true, data: { new_views: newViews } });
}

// GET /api/v1/photos/:photoId/insights
export async function photoInsights(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Photo not found" },
    });
    return;
  }

  // Only photo owner can see insights
  if (photo.user_id !== userId) {
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Only the photo owner can view insights" },
    });
    return;
  }

  const insights = await getPhotoInsights(photoId);
  res.json({ success: true, data: { insights } });
}

// POST /api/v1/photos/:photoId/save
export async function savePhotoController(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  const photo = await findPhotoById(photoId);
  if (!photo) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Photo not found" } });
    return;
  }

  await savePhoto(photoId, userId);
  res.status(201).json({ success: true, data: { saved: true } });
}

// DELETE /api/v1/photos/:photoId/save
export async function unsavePhotoController(req: Request, res: Response) {
  const photoId = req.params.photoId as string;
  const userId = req.user!.userId;

  await unsavePhoto(photoId, userId);
  res.json({ success: true, data: { saved: false } });
}

// GET /api/v1/photos/saved
export async function getSavedPhotosController(req: Request, res: Response) {
  const userId = req.user!.userId;
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Number(req.query.offset) || 0;

  const photos = await getSavedPhotos(userId, limit, offset);
  res.json({ success: true, data: { photos } });
}
