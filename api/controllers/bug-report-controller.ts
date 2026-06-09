import { Request, Response } from "express";
import multer from "multer";
import { submitBugReportSchema } from "../validators/bug-report-validators";
import { createBugReport } from "../../dblayer/bug-report-queries";
import { uploadToStorage } from "../lib/supabase";
import {
  compressImage,
  detectImageMimeFromMagic,
  extensionForMime,
  SUPPORTED_MIMES,
} from "../../algorithms/image-compression";
import { v4 as uuidv4 } from "uuid";

const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_SCREENSHOTS = 3;
const ALLOWED_MIMES: string[] = [...SUPPORTED_MIMES];

export const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SCREENSHOT_SIZE,
    files: MAX_SCREENSHOTS,
  },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "Only JPEG, PNG, and WebP images are allowed"));
    }
  },
});

// POST /api/v1/bug-reports
export async function submitBugReport(req: Request, res: Response) {
  const parsed = submitBugReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message || "Invalid input" },
    });
    return;
  }

  const { category, severity, affected_feature, steps_to_reproduce, expected_behavior, actual_behavior } = parsed.data;

  // Upload screenshots to Supabase storage (if any)
  const screenshotUrls: string[] = [];
  const files = req.files as Express.Multer.File[] | undefined;
  if (files && files.length > 0) {
    for (const file of files.slice(0, MAX_SCREENSHOTS)) {
      const detectedMime = detectImageMimeFromMagic(file.buffer);
      if (!detectedMime || !ALLOWED_MIMES.includes(detectedMime)) {
        continue; // skip invalid files silently — don't block the report
      }
      try {
        const compressed = await compressImage({ buffer: file.buffer, detectedMime });
        const ext = extensionForMime(compressed.mime);
        const filename = `${uuidv4()}${ext}`;
        const url = await uploadToStorage("bug-screenshots", compressed.buffer, filename, compressed.mime);
        screenshotUrls.push(url);
      } catch {
        // Upload failure should not block the bug report itself
      }
    }
  }

  const reporterId = req.user?.userId ?? null;

  const report = await createBugReport({
    reporterId,
    category,
    severity,
    affectedFeature: affected_feature,
    stepsToReproduce: steps_to_reproduce,
    expectedBehavior: expected_behavior,
    actualBehavior: actual_behavior,
    screenshotUrls,
  });

  res.status(201).json({
    success: true,
    data: { report: { id: report.id, created_at: report.created_at } },
  });
}
