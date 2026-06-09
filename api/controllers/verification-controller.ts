import { Request, Response } from "express";
import multer from "multer";
import { submitVerificationSchema } from "../validators/verification-validators";
import {
  getHostVerification,
  getHostVerificationRaw,
  createHostVerification,
  updateHostVerification,
} from "../../dblayer/verification-queries";
import { validateKyc } from "../../ai-and-bots/pan-validator";
import { uploadToStorage } from "../lib/supabase";
import { logger } from "../lib/logger";

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "5242880", 10);
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"];
const KYC_BUCKET = process.env.SUPABASE_KYC_BUCKET || "kyc-documents";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

function getUploadedFile(req: Request, fieldName: string): Express.Multer.File | null {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.[fieldName]?.[0];
  return file ?? null;
}

// ── GET /api/v1/verification/host ────────────────────────────────────────────
export async function getStatus(req: Request, res: Response) {
  const userId = req.user!.userId;
  const verification = await getHostVerification(userId);

  res.json({
    success: true,
    data: { verification },
  });
}

// ── POST /api/v1/verification/host ───────────────────────────────────────────
export async function submit(req: Request, res: Response) {
  const userId = req.user!.userId;

  // Check if already approved — approved verifications cannot be replaced via submit
  const existing = await getHostVerification(userId);
  if (existing?.status === "approved") {
    res.status(409).json({
      success: false,
      error: {
        code: "ALREADY_VERIFIED",
        message: "Your host verification is already approved. Use the update endpoint to change details.",
      },
    });
    return;
  }
  if (existing) {
    res.status(409).json({
      success: false,
      error: {
        code: "ALREADY_SUBMITTED",
        message: "You already have a pending verification. Use PUT to resubmit with updated details.",
      },
    });
    return;
  }

  // Validate text fields
  const parsed = submitVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const panImageFile = getUploadedFile(req, "pan_image");
  const aadhaarImageFile = getUploadedFile(req, "aadhaar_image");

  // PAN and Aadhaar images are required on first submission
  if (!panImageFile || !aadhaarImageFile) {
    res.status(400).json({
      success: false,
      error: { code: "MISSING_IMAGE", message: "Both PAN and Aadhaar images are required" },
    });
    return;
  }

  // Upload PAN and Aadhaar images to private KYC bucket
  let panImageUrl: string;
  let aadhaarImageUrl: string;
  try {
    panImageUrl = await uploadToStorage(
      KYC_BUCKET,
      panImageFile.buffer,
      panImageFile.originalname,
      panImageFile.mimetype
    );
    aadhaarImageUrl = await uploadToStorage(
      KYC_BUCKET,
      aadhaarImageFile.buffer,
      aadhaarImageFile.originalname,
      aadhaarImageFile.mimetype
    );
  } catch (uploadError) {
    logger.error("KYC image upload failed", { userId, error: uploadError });
    res.status(500).json({
      success: false,
      error: { code: "UPLOAD_FAILED", message: "Failed to upload KYC images. Please try again." },
    });
    return;
  }

  // Run bot validation
  const kycCheck = validateKyc({
    panNumber: parsed.data.pan_number,
    panName: parsed.data.pan_name,
    aadhaarNumber: parsed.data.aadhaar_number,
    aadhaarName: parsed.data.aadhaar_name,
    bankAccountNumber: parsed.data.bank_account_number,
    bankIfsc: parsed.data.bank_ifsc,
    bankAccountName: parsed.data.bank_account_name,
  });

  // Log flags without logging raw PAN/account for security
  if (kycCheck.allFlags.length > 0) {
    logger.warn("KYC auto-flags raised", { userId, flags: kycCheck.allFlags });
  }

  const verification = await createHostVerification({
    userId,
    panNumber: parsed.data.pan_number,
    panName: parsed.data.pan_name,
    panImageUrl,
    aadhaarNumber: parsed.data.aadhaar_number,
    aadhaarName: parsed.data.aadhaar_name,
    aadhaarImageUrl,
    bankAccountNumber: parsed.data.bank_account_number,
    bankIfsc: parsed.data.bank_ifsc,
    bankAccountName: parsed.data.bank_account_name,
    bankName: parsed.data.bank_name,
    autoFlags: kycCheck.allFlags.length > 0 ? kycCheck.allFlags : null,
  });

  res.status(201).json({
    success: true,
    data: { verification },
  });
}

// ── PUT /api/v1/verification/host ─────────────────────────────────────────────
// Re-submit after rejection, or update details (resets to pending)
export async function update(req: Request, res: Response) {
  const userId = req.user!.userId;

  const existing = await getHostVerificationRaw(userId);
  if (!existing) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "No existing verification found. Use POST to submit for the first time." },
    });
    return;
  }

  // Validate text fields
  const parsed = submitVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  // PAN/Aadhaar images: use new upload if provided, otherwise keep existing URLs
  let panImageUrl = existing.pan_image_url as unknown as string;
  let aadhaarImageUrl = existing.aadhaar_image_url as unknown as string;
  const panImageFile = getUploadedFile(req, "pan_image");
  const aadhaarImageFile = getUploadedFile(req, "aadhaar_image");

  if (panImageFile) {
    try {
      panImageUrl = await uploadToStorage(
        KYC_BUCKET,
        panImageFile.buffer,
        panImageFile.originalname,
        panImageFile.mimetype
      );
    } catch (uploadError) {
      logger.error("KYC image upload failed (update)", { userId, error: uploadError });
      res.status(500).json({
        success: false,
        error: { code: "UPLOAD_FAILED", message: "Failed to upload PAN image. Please try again." },
      });
      return;
    }
  }

  if (aadhaarImageFile) {
    try {
      aadhaarImageUrl = await uploadToStorage(
        KYC_BUCKET,
        aadhaarImageFile.buffer,
        aadhaarImageFile.originalname,
        aadhaarImageFile.mimetype
      );
    } catch (uploadError) {
      logger.error("KYC image upload failed (update)", { userId, error: uploadError });
      res.status(500).json({
        success: false,
        error: { code: "UPLOAD_FAILED", message: "Failed to upload Aadhaar image. Please try again." },
      });
      return;
    }
  }

  const kycCheck = validateKyc({
    panNumber: parsed.data.pan_number,
    panName: parsed.data.pan_name,
    aadhaarNumber: parsed.data.aadhaar_number,
    aadhaarName: parsed.data.aadhaar_name,
    bankAccountNumber: parsed.data.bank_account_number,
    bankIfsc: parsed.data.bank_ifsc,
    bankAccountName: parsed.data.bank_account_name,
  });

  if (kycCheck.allFlags.length > 0) {
    logger.warn("KYC auto-flags raised (update)", { userId, flags: kycCheck.allFlags });
  }

  const verification = await updateHostVerification({
    userId,
    panNumber: parsed.data.pan_number,
    panName: parsed.data.pan_name,
    panImageUrl,
    aadhaarNumber: parsed.data.aadhaar_number,
    aadhaarName: parsed.data.aadhaar_name,
    aadhaarImageUrl,
    bankAccountNumber: parsed.data.bank_account_number,
    bankIfsc: parsed.data.bank_ifsc,
    bankAccountName: parsed.data.bank_account_name,
    bankName: parsed.data.bank_name,
    autoFlags: kycCheck.allFlags.length > 0 ? kycCheck.allFlags : null,
  });

  res.json({
    success: true,
    data: { verification },
  });
}
