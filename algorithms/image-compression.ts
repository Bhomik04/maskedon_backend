// Image Compression Algorithm — Pure function, no DB or HTTP imports.
// Compresses uploaded images to ensure no stored image exceeds 5 MB.
// Uses sharp for image processing.

import sharp from "sharp";

// ── Configuration Constants ──────────────────────────────────────────
/** Images ≤ 2 MB pass through untouched */
export const COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;

/** Images > 15 MB get aggressive compression (large phone photos, DSLRs) */
export const HEAVY_COMPRESS_THRESHOLD_BYTES = 15 * 1024 * 1024;

/** Absolute ceiling — no image bigger than this may be stored */
export const MAX_STORED_IMAGE_SIZE = 5 * 1024 * 1024;

/** MIME types the algorithm supports */
export const SUPPORTED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedMime = (typeof SUPPORTED_MIMES)[number];

// ── Compression Profiles ─────────────────────────────────────────────
/**
 * Standard compression — images between 2 MB and 15 MB.
 * Starts with high quality + large dimensions and steps down until
 * the output fits under MAX_STORED_IMAGE_SIZE.
 */
const STANDARD_PROFILE = {
  maxDimensions: [3840, 3200, 2560, 2048, 1600],
  qualityLevels: [82, 75, 68, 62, 56, 50],
} as const;

/**
 * Heavy compression — images above 15 MB.
 * Starts with more aggressive downscaling and lower quality floors.
 */
const HEAVY_PROFILE = {
  maxDimensions: [2560, 2048, 1600, 1280, 1024],
  qualityLevels: [58, 48, 40, 34, 28, 24],
} as const;

// ── Interfaces ───────────────────────────────────────────────────────
export interface CompressionInput {
  buffer: Buffer;
  /** Original MIME type detected from the file (magic bytes or multer) */
  detectedMime: string;
}

export interface CompressionResult {
  /** The (possibly compressed) image buffer ready for storage */
  buffer: Buffer;
  /** Output MIME type — may differ from input (e.g. PNG → WebP) */
  mime: string;
  /** Whether any compression was actually applied */
  wasCompressed: boolean;
  /** Original size in bytes */
  originalSize: number;
  /** Final size in bytes */
  finalSize: number;
}

// ── Helper: file extension for a MIME type ───────────────────────────
export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

// ── Helper: detect MIME from magic bytes ─────────────────────────────
/**
 * Reads the first few bytes of a buffer to determine the true image
 * format regardless of what the filename or Content-Type header says.
 * Returns null if the format is not recognized.
 */
export function detectImageMimeFromMagic(buffer: Buffer): string | null {
  // JPEG: starts with FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: starts with RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

// ── Core Algorithm ───────────────────────────────────────────────────
/**
 * Compresses an image buffer so it fits within MAX_STORED_IMAGE_SIZE (5 MB).
 *
 * ### Rules
 * 1. **≤ 2 MB** → No compression. Passed through as-is.
 * 2. **2 MB – 15 MB** → Standard compression profile.
 *    Progressively reduces resolution and quality until size < 5 MB.
 * 3. **> 15 MB** → Heavy compression profile.
 *    Starts with smaller dimensions and lower quality floors.
 *
 * ### How it works
 * The algorithm iterates through a matrix of `(maxDimension, quality)` pairs,
 * trying the highest quality + resolution first. It picks the first combination
 * that produces an output ≤ 5 MB. If no combination succeeds, the smallest
 * result from the entire search space is returned.
 *
 * ### Output format
 * - JPEG inputs stay JPEG (re-encoded with mozjpeg for smaller size).
 * - PNG / WebP inputs are converted to WebP for better compression.
 */
export async function compressImage(input: CompressionInput): Promise<CompressionResult> {
  const { buffer: inputBuffer, detectedMime } = input;
  const originalSize = inputBuffer.length;

  // ── Pass-through: already small enough ──
  if (originalSize <= COMPRESS_THRESHOLD_BYTES) {
    return {
      buffer: inputBuffer,
      mime: detectedMime,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }

  // ── Pick compression profile based on size tier ──
  const isHeavy = originalSize > HEAVY_COMPRESS_THRESHOLD_BYTES;
  const profile = isHeavy ? HEAVY_PROFILE : STANDARD_PROFILE;

  // JPEG stays JPEG (mozjpeg); everything else → WebP (superior compression)
  const outputMime = detectedMime === "image/jpeg" ? "image/jpeg" : "image/webp";

  let smallestBuffer: Buffer | null = null;

  for (const maxDimension of profile.maxDimensions) {
    for (const quality of profile.qualityLevels) {
      const basePipeline = sharp(inputBuffer, { failOn: "none" })
        .rotate() // auto-orient from EXIF
        .resize(maxDimension, maxDimension, {
          fit: "inside",
          withoutEnlargement: true,
        });

      const compressedBuffer =
        outputMime === "image/jpeg"
          ? await basePipeline
              .jpeg({ quality, mozjpeg: true, progressive: true, force: true })
              .toBuffer()
          : await basePipeline.webp({ quality, effort: 6 }).toBuffer();

      // Track the smallest result we've seen across the whole search
      if (!smallestBuffer || compressedBuffer.length < smallestBuffer.length) {
        smallestBuffer = compressedBuffer;
      }

      // First combination that fits under the cap wins
      if (compressedBuffer.length <= MAX_STORED_IMAGE_SIZE) {
        return {
          buffer: compressedBuffer,
          mime: outputMime,
          wasCompressed: true,
          originalSize,
          finalSize: compressedBuffer.length,
        };
      }
    }
  }

  // Exhausted all combinations — return the smallest we found
  return {
    buffer: smallestBuffer || inputBuffer,
    mime: outputMime,
    wasCompressed: true,
    originalSize,
    finalSize: (smallestBuffer || inputBuffer).length,
  };
}
