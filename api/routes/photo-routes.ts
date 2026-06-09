import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { validateUUIDParam } from "../middleware/validate-uuid";
import { asyncHandler } from "../utils/async-handler";
import * as photoCtrl from "../controllers/photo-controller";
import { photoUploadLimiter, socialActionLimiter } from "../middleware/rate-limiters";

const router = Router();

router.param("photoId", validateUUIDParam);
router.param("commentId", validateUUIDParam);

// Saved photos — must come before /:photoId to avoid routing conflict
router.get("/saved", authenticate, asyncHandler(photoCtrl.getSavedPhotosController));

// Upload photo (bandwidth-intensive — tighter limit)
router.post("/", authenticate, photoUploadLimiter, photoCtrl.upload.single("image"), asyncHandler(photoCtrl.uploadPhoto));

// Photo detail
router.get("/:photoId", authenticate, asyncHandler(photoCtrl.getPhoto));

// Delete photo
router.delete("/:photoId", authenticate, asyncHandler(photoCtrl.removePhoto));

// Like / Unlike (social spam prevention)
router.post("/:photoId/like", authenticate, socialActionLimiter, asyncHandler(photoCtrl.like));
router.delete("/:photoId/like", authenticate, asyncHandler(photoCtrl.unlike));
router.get("/:photoId/likes", authenticate, asyncHandler(photoCtrl.listPhotoLikers));

// Save / Unsave
router.post("/:photoId/save", authenticate, socialActionLimiter, asyncHandler(photoCtrl.savePhotoController));
router.delete("/:photoId/save", authenticate, asyncHandler(photoCtrl.unsavePhotoController));

// Comments (social spam prevention)
router.post("/:photoId/comments", authenticate, socialActionLimiter, asyncHandler(photoCtrl.addComment));
router.get("/:photoId/comments", authenticate, asyncHandler(photoCtrl.listPhotoComments));
router.put("/comments/:commentId", authenticate, socialActionLimiter, asyncHandler(photoCtrl.editComment));
router.delete("/comments/:commentId", authenticate, asyncHandler(photoCtrl.removeComment));
router.patch("/comments/:commentId/pin", authenticate, asyncHandler(photoCtrl.togglePinComment));

// Caption edit
router.patch("/:photoId/caption", authenticate, asyncHandler(photoCtrl.editCaption));

// Views & Insights
router.post("/views/batch", authenticate, asyncHandler(photoCtrl.recordViewsBatch));
router.post("/:photoId/view", authenticate, asyncHandler(photoCtrl.recordView));
router.get("/:photoId/insights", authenticate, asyncHandler(photoCtrl.photoInsights));

export default router;
