# Algorithms (`algorithms/`)

Pure business logic functions with zero dependencies on Express, HTTP, or the database layer. These modules perform computations that are consumed by the API controllers.

---

## Directory Structure

```
algorithms/
├── discovery-algorithm.ts   # Personalized post discovery (Resonance Scoring)
├── feed-algorithm.ts        # Feed ranking algorithm (recency + engagement)
├── image-compression.ts     # Adaptive image compression for storage
├── event-score.ts          # Per-event adjusted score (friend bonus + report penalty)
├── social-rating.ts         # Trust level mapping from crowd rating
└── readme.md                # This file
```

---

## Event Score Algorithm (`event-score.ts`)

Calculates each user's **individual adjusted score** for a specific event, layering two modifiers on top of the raw crowd average. This per-event score then feeds into `aggregateSocialRating()` to produce the user's overall social rating.

### How It Works

The event's crowd average (sum of all ratings ÷ attendee count) is the base. Two modifiers are applied in a strict priority order:

#### Friend Bonus
If the user has friends among the attendees, they receive a bonus added to the rating numerator:

$$\text{friendAdjustedScore} = \frac{\text{ratingSum} + (\text{friendsInEvent} \times 2)}{\text{eventAttendeeCount}}$$

Capped at **5.0**. Friend bonus is only applied when the user has **0 or 1 report** in this event.

#### Report Penalty (higher priority than friends)

| Reports in event | Rule |
|-----------------|------|
| 0 | No penalty — friend-adjusted score is final |
| 1 | Friend bonus applied first, then **−1.0** deducted (floor: 1.0) |
| 2 | Score **forced to 2.0** — friend bonus ignored |
| ≥ 3 | Score **forced to 1.0** — friend bonus ignored |

### Examples

| Scenario | Event Avg | Friends | Reports | Final Score |
|----------|-----------|---------|---------|-------------|
| Clean guest, no friends | 4.0 | 0 | 0 | **4.0** |
| 1 misbehaviour report, no friends | 4.0 | 0 | 1 | **3.0** |
| 2 reports (friends irrelevant) | 4.0 | 4 | 2 | **2.0** |
| 3+ reports (friends irrelevant) | 4.0 | 4 | 3 | **1.0** |
| 3 friends, no reports | 3.0 (sum=30, n=10) | 3 | 0 | **3.6** `(30+6)/10` |
| 4 friends, no reports | 3.0 (sum=30, n=10) | 4 | 0 | **3.8** `(30+8)/10` |
| 4 friends, 1 report | 3.0 (sum=30, n=10) | 4 | 1 | **2.8** `3.8−1.0` |
| 4 friends, 2 reports (friends ignored) | 3.0 (sum=30, n=10) | 4 | 2 | **2.0** |

### Interface

```typescript
// Per-event calculation
function calculateEventScore(input: EventScoreInput): EventScoreResult

// Aggregate across all events → overall social rating
function aggregateSocialRating(records: UserEventRecord[]): SocialRatingResult
```

### DB Requirements

To use this algorithm, the controller needs to pre-fetch per event, per user:
- `ratingSum` + `eventAttendeeCount` — from `crowd_ratings` and `event_attendees`
- `friendsInEvent` — from `friendships` joined with `event_attendees`
- `reportsInEvent` — from `reports` where `target_type = 'user'` scoped to the event's time window (an `event_id` column on the `reports` table is recommended)

---

## Social Rating (`social-rating.ts`)

Calculates a user's social rating based on all ratings they've received, with recency weighting to ensure recent behavior matters more than old history.

### How It Works

Every user on maskedon has a **social rating** (1.00–5.00 scale) computed from ratings given by fellow event attendees. The algorithm applies a time-based weighting system:

1. **Collect** all ratings received by the user
2. **Weight** each rating based on age:
   - Ratings from the **last 90 days** → weight of **2.0** (recent behavior counts double)
   - Ratings **older than 90 days** → weight of **1.0** (still counted, but less influential)
3. **Compute** weighted average: $\text{social\_rating} = \frac{\sum (\text{score} \times \text{weight})}{\sum \text{weight}}$
4. **Round** to 2 decimal places

### Display Rules

- **Fewer than 3 ratings:** Displays `"Not enough ratings yet"` — prevents manipulation from a small sample
- **3 or more ratings:** Displays `"★ 4.2 (17 ratings)"` format

### Interface

```typescript
interface RatingInput {
  score: number;      // 1-5 integer
  created_at: Date;   // When the rating was given
}

interface RatingResult {
  social_rating: number;    // Weighted average (0.00-5.00)
  total_ratings: number;    // Raw count of all ratings
  display: string;          // Human-readable display string
}

function calculateSocialRating(
  ratings: RatingInput[],
  now?: Date                 // Optional, defaults to current time (useful for testing)
): RatingResult;
```

### Configuration Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `RECENCY_THRESHOLD_DAYS` | 90 | Ratings within this window get boosted weight |
| `RECENT_WEIGHT` | 2.0 | Weight multiplier for recent ratings |
| `OLD_WEIGHT` | 1.0 | Weight multiplier for older ratings |
| `MIN_RATINGS_TO_DISPLAY` | 3 | Minimum ratings before showing a score |

### Usage

The `rating-controller.ts` calls this function after every new rating submission to recalculate the rated user's `social_rating` and `total_ratings` in the `users` table:

```typescript
import { calculateSocialRating } from "@algorithms/social-rating";

// After a new rating is submitted:
const allRatings = await getRatingsForUser(ratedUserId);
const result = calculateSocialRating(allRatings);
await updateSocialRating(ratedUserId, result.social_rating, result.total_ratings);
```

### Design Principles

- **Pure function** — No side effects, no DB calls, no HTTP. Takes data in, returns result.
- **Testable** — Accepts an optional `now` parameter for deterministic testing.
- **Fair** — Recency weighting prevents users from coasting on old good ratings while behaving poorly recently. The minimum threshold prevents rating manipulation from one or two colluding users.

---

## Image Compression Algorithm (`image-compression.ts`)

Ensures no uploaded image exceeds 5 MB before it is stored in the database. Uses [sharp](https://sharp.pixelplumbing.com/) for high-performance image processing.

### How It Works

When a user uploads a photo, the raw buffer passes through this algorithm **before** being sent to storage:

```
User uploads image
       │
       ▼
  ≤ 2 MB? ──yes──▶ Pass through (no compression)
       │
      no
       │
       ▼
  > 15 MB? ──yes──▶ Heavy compression profile
       │
      no
       │
       ▼
  Standard compression profile
       │
       ▼
  Output ≤ 5 MB? ──yes──▶ Done ✓
       │
      no (try next dimension × quality combo)
       │
       ▼
  All combos exhausted → return smallest result
```

1. **≤ 2 MB** — Returned as-is. No processing overhead for small images.
2. **2 MB – 15 MB** — Standard profile: starts at 3840px / quality 82 and steps down through 5 resolutions × 6 quality levels until the result fits under 5 MB.
3. **> 15 MB** — Heavy profile: starts at 2560px / quality 58 with more aggressive floors to handle massive DSLR/RAW-export images.

### Output Format

- **JPEG** inputs stay JPEG (re-encoded with mozjpeg for ~20% smaller output).
- **PNG / WebP** inputs are converted to WebP (superior compression at equivalent quality).

### Interface

```typescript
interface CompressionInput {
  buffer: Buffer;
  detectedMime: string;   // "image/jpeg" | "image/png" | "image/webp"
}

interface CompressionResult {
  buffer: Buffer;          // Ready-to-store image buffer
  mime: string;            // Output MIME type
  wasCompressed: boolean;  // Whether compression was applied
  originalSize: number;    // Input size in bytes
  finalSize: number;       // Output size in bytes
}

function compressImage(input: CompressionInput): Promise<CompressionResult>;
```

### Configuration Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `COMPRESS_THRESHOLD_BYTES` | 2 MB | Images at or below this skip compression |
| `HEAVY_COMPRESS_THRESHOLD_BYTES` | 15 MB | Images above this use the heavy profile |
| `MAX_STORED_IMAGE_SIZE` | 5 MB | Absolute ceiling for stored images |

### Compression Profiles

| Profile | Max Dimensions (px) | Quality Levels | Use Case |
|---------|---------------------|----------------|----------|
| **Standard** | 3840 → 3200 → 2560 → 2048 → 1600 | 82 → 75 → 68 → 62 → 56 → 50 | Phone photos (2–15 MB) |
| **Heavy** | 2560 → 2048 → 1600 → 1280 → 1024 | 58 → 48 → 40 → 34 → 28 → 24 | DSLR / RAW exports (>15 MB) |

### Utility Functions

- **`extensionForMime(mime)`** — Returns the file extension (`.jpg`, `.png`, `.webp`) for a MIME type.
- **`detectImageMimeFromMagic(buffer)`** — Reads magic bytes to determine the true image format, ignoring spoofed Content-Type headers.

### Usage

The `photo-controller.ts` calls this algorithm during photo upload:

```typescript
import {
  compressImage,
  detectImageMimeFromMagic,
  extensionForMime,
  MAX_STORED_IMAGE_SIZE,
} from "@algorithms/image-compression";

// In the upload handler:
const detectedMime = detectImageMimeFromMagic(req.file.buffer);
const result = await compressImage({ buffer: req.file.buffer, detectedMime });

if (result.finalSize > MAX_STORED_IMAGE_SIZE) {
  return res.status(413).json({ error: "Image too large" });
}

const ext = extensionForMime(result.mime);
await uploadToStorage("photos", result.buffer, `${photoId}${ext}`, result.mime);
```

### Design Principles

- **Pure function** — No side effects, no DB calls, no HTTP. Takes a buffer in, returns a buffer out.
- **Adaptive** — Automatically selects the right compression intensity based on input size.
- **Greedy-optimal** — Tries highest quality first and stops at the first combination that fits, so output quality is always as high as possible within the 5 MB budget.
- **Format-aware** — Uses mozjpeg for JPEG (best-in-class JPEG encoder) and WebP for everything else.
