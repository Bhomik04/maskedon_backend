import { Request, Response } from "express";
import multer from "multer";
import { markIdVerificationSubmitted, getSelfProfile } from "../../dblayer/user-queries";
import { uploadToPrivateStorage } from "../lib/supabase";
import { logger } from "../lib/logger";

const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];
const ID_DOCS_BUCKET = "id-documents";

export const idDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// POST /api/v1/users/me/id-verification
export async function submitIdVerification(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({
      success: false,
      error: { code: "NO_FILE", message: "ID document image is required" },
    });
    return;
  }

  const userId = req.user!.userId;

  // Prevent re-submission if already pending or verified
  const profile = await getSelfProfile(userId);
  if (!profile) {
    res.status(404).json({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
    });
    return;
  }

  if (profile.id_verification_status === "pending") {
    res.status(409).json({
      success: false,
      error: {
        code: "VERIFICATION_PENDING",
        message: "Your ID document is already under review. Please wait for the outcome before resubmitting.",
      },
    });
    return;
  }

  if (profile.id_verification_status === "verified") {
    res.status(409).json({
      success: false,
      error: {
        code: "ALREADY_VERIFIED",
        message: "Your identity is already verified.",
      },
    });
    return;
  }

  try {
    // Upload to private bucket — path stored in Supabase Storage, NOT in the DB
    await uploadToPrivateStorage(
      ID_DOCS_BUCKET,
      userId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Only store the verification STATUS change in DB — no file path or URL
    await markIdVerificationSubmitted(userId);

    logger.info("ID verification document submitted", { userId });

    res.status(200).json({
      success: true,
      data: {
        id_verification_status: "pending",
        message: "Your ID document has been submitted for review. We'll notify you within 2-3 business days.",
      },
    });
  } catch (error) {
    logger.error("ID verification upload failed", { userId, error });
    res.status(500).json({
      success: false,
      error: { code: "UPLOAD_FAILED", message: "Failed to upload document. Please try again." },
    });
  }
}
