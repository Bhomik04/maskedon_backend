# API Layer (`api/`)

The REST API server for the maskedon platform. Built with Express 5 and TypeScript, this module handles HTTP routing, request validation, authentication, file uploads, and response formatting. It consumes the `dblayer/` for data access and `algorithms/` for business logic computations.

---

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Express | 5.2.1 | HTTP framework |
| TypeScript | 5.9.3 | Type-safe development |
| Helmet | 8.1.0 | HTTP security headers |
| CORS | 2.8.6 | Cross-origin resource sharing |
| express-rate-limit | 8.3.1 | Brute-force protection on auth endpoints |
| Zod | 4.3.6 | Runtime request validation |
| jsonwebtoken | 9.0.3 | JWT access & refresh tokens |
| bcrypt | 6.0.0 | Password hashing (12 rounds) |
| multer | 2.1.1 | Multipart file upload handling (memory storage) |
| Supabase JS | 2.99.0 | Cloud storage for images |

---

## Directory Structure

```
api/
├── server.ts                   # Express app setup, middleware stack, route mounting
├── controllers/
│   ├── auth-controller.ts      # Register, login, refresh, logout
│   ├── user-controller.ts      # Profile CRUD, avatar upload, search
│   ├── event-controller.ts     # Event CRUD, discovery, attendees
│   ├── request-controller.ts   # Join request lifecycle + mutual friends
│   ├── payment-controller.ts   # Mock payment processing
│   ├── rating-controller.ts    # Post-event ratings + social rating recalc
│   ├── photo-controller.ts     # Photo upload/delete, likes, galleries
│   ├── notification-controller.ts  # Notification list, mark read, unread count
│   └── friend-controller.ts    # Friend requests, accept/reject, unfriend, mutual friends
├── routes/
│   ├── auth-routes.ts          # POST /auth/*
│   ├── user-routes.ts          # GET/PUT /users/*
│   ├── event-routes.ts         # CRUD /events/*
│   ├── photo-routes.ts         # /photos/*
│   ├── notification-routes.ts  # /notifications/*
│   └── friend-routes.ts        # /friends/*
├── middleware/
│   ├── auth.ts                 # JWT verification middleware
│   └── error-handler.ts        # Global error handler
├── validators/
│   ├── auth-validators.ts      # Login & register schemas
│   ├── user-validators.ts      # Profile update schemas
│   ├── event-validators.ts     # Event creation & update schemas
│   ├── photo-validators.ts     # Photo upload schemas
│   └── rating-validators.ts    # Rating submission schemas
├── utils/
│   └── auth-helpers.ts         # JWT sign/verify, bcrypt, token hashing
├── lib/
│   └── supabase.ts             # Supabase Storage upload/delete helpers
└── readme.md                   # This file
```

---

## Server Configuration (`server.ts`)

The Express app is configured with the following middleware stack (in order):

1. **Helmet** — Sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
2. **CORS** — Allows `http://localhost:5173` in development, `FRONTEND_URL` in production
3. **Rate Limiter** — Applied to `/api/v1/auth/*` only (20 requests per 15 minutes)
4. **Body Parsing** — JSON (1MB limit) and URL-encoded

**Health Check:** `GET /api/v1/health` — Returns `{ status: "ok", timestamp }` (no auth required)

**Startup:** Tests database connectivity, warns if unavailable, starts listening on `PORT` (default 5000)

---

## API Endpoints

All endpoints are prefixed with `/api/v1`.

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Create account (email, username, password, display_name) |
| POST | `/auth/login` | No | Login with email + password, returns tokens |
| POST | `/auth/refresh` | No | Exchange refresh token for new token pair |
| POST | `/auth/logout` | Yes | Invalidate refresh token |

**Token System:**
- Access token: JWT, 15 minutes, sent in `Authorization: Bearer <token>` header
- Refresh token: JWT, 7 days, hashed with SHA-256 before storage in `refresh_tokens` table
- Refresh token rotation: each refresh issues a new pair and invalidates the old one

### Users (`/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/me` | Yes | Get authenticated user's full profile |
| PUT | `/users/me` | Yes | Update profile (display_name, bio) |
| PUT | `/users/me/avatar` | Yes | Upload avatar image (multipart, max 5MB) |
| GET | `/users/:id` | Yes | Get another user's public profile |
| GET | `/users/:id/ratings` | Yes | Get all ratings received by a user |
| GET | `/users/search?q=` | Yes | Search users by username or display name |

### Events (`/events`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events` | Yes | Create a new event |
| GET | `/events` | Yes | Discover events (filters: city, status, date, price, tags, page, limit) |
| GET | `/events/:eventId` | Yes | Get event details with host info |
| PUT | `/events/:eventId` | Yes | Update event (host only) |
| PATCH | `/events/:eventId/cancel` | Yes | Cancel event (host only) |
| GET | `/events/:eventId/attendees` | Yes | List confirmed attendees |

### Join Requests (nested under `/events`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events/:eventId/requests` | Yes | Send join request (with optional message) |
| GET | `/events/:eventId/requests` | Yes | List requests for a event (host only) |
| PATCH | `/events/:eventId/requests/:requestId` | Yes | Approve/reject request with `{ status }` |
| DELETE | `/events/:eventId/requests/:requestId` | Yes | Withdraw own request |
| GET | `/users/me/requests` | Yes | Get all requests sent by authenticated user |

### Payments (nested under `/events`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events/:eventId/pay` | Yes | Process mock payment for approved request |

### Ratings (nested under `/events`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events/:eventId/ratings` | Yes | Rate an attendee (score 1-5, optional comment) |
| GET | `/events/:eventId/ratings` | Yes | Get all ratings for a event |
| PUT | `/events/:eventId/ratings/:ratingId` | Yes | Edit an existing rating |

**Rating Rules:**
- Only attendees of the same event can rate each other
- No self-rating
- One rating per pair per event
- 7-day window after event completion
- Recalculates the rated user's `social_rating` using the algorithm from `algorithms/`

### Photos (`/photos`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/photos` | Yes | Upload photo (multipart, max 5MB, optional event_id + caption) |
| GET | `/photos/:photoId` | Yes | Get single photo details |
| DELETE | `/photos/:photoId` | Yes | Soft-delete a photo (owner only) + remove from Supabase |
| POST | `/photos/:photoId/like` | Yes | Like a photo |
| DELETE | `/photos/:photoId/like` | Yes | Unlike a photo |
| GET | `/users/:userId/photos` | Yes | Get a user's photo gallery |
| GET | `/events/:eventId/photos` | Yes | Get a event's photo album |

### Notifications (`/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | Yes | List notifications (paginated) |
| GET | `/notifications/unread-count` | Yes | Get unread badge count |
| PATCH | `/notifications/:notificationId/read` | Yes | Mark single notification as read |
| PATCH | `/notifications/read-all` | Yes | Mark all as read |

### Friends (`/friends`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/friends/me` | Yes | List accepted friends (paginated) |
| GET | `/friends/me/pending` | Yes | List incoming pending requests |
| GET | `/friends/me/count` | Yes | Get total friend count |
| POST | `/friends/:userId` | Yes | Send friend request |
| PATCH | `/friends/:userId/accept` | Yes | Accept friend request from this user |
| PATCH | `/friends/:userId/reject` | Yes | Reject friend request from this user |
| DELETE | `/friends/:userId` | Yes | Unfriend or cancel pending request with this user |
| GET | `/friends/:userId/list` | Yes | List this user's friends (paginated) |
| GET | `/friends/:userId/status` | Yes | Check friendship status with this user |
| GET | `/friends/:userId/mutual` | Yes | Get mutual friends with this user |

---

## Authentication Middleware (`middleware/auth.ts`)

Extracts the JWT from the `Authorization: Bearer <token>` header, verifies it, and attaches `req.user` with `{ userId, username }`. Returns 401 if missing or invalid.

```typescript
// Usage in routes:
router.get("/me", authenticate, getMe);
```

---

## Validation (`validators/`)

All request bodies are validated using Zod v4 schemas before reaching controller logic. Validation happens at the controller level — the controller calls `schema.parse(req.body)` and catches `ZodError` to return structured 400 responses.

---

## File Uploads

**Flow:** Client sends `multipart/form-data` → multer (memory storage, 5MB limit) → controller extracts buffer → `uploadToStorage()` uploads to Supabase → public URL stored in PostgreSQL.

**Storage Buckets:**
- `avatars` — User profile pictures
- `photos` — Event and user photos

**Deletion:** When a photo is deleted, the controller calls `deleteFromStorage()` which extracts the file path from the Supabase public URL and removes it from the bucket.

---

## Error Handling (`middleware/error-handler.ts`)

Global Express error handler (4-argument middleware). Returns:
- **Development:** Full error message
- **Production:** Generic "An unexpected error occurred"

All errors are logged to console with full stack traces.

---

## Notification Triggers

Notifications are created automatically by these controllers:

| Event | Notified User | Type |
|-------|--------------|------|
| Join request submitted | Event host | `join_request` |
| Request approved | Requester | `request_approved` |
| Request rejected | Requester | `request_rejected` |
| Rating received | Rated user | `new_rating` |
| Photo liked | Photo owner | `photo_liked` |
| Friend request received | Addressee | `friend_request` |
| Friend request accepted | Original requester | `friend_accepted` |

---

## Running the Server

```bash
# Development (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The dev server runs on `http://localhost:5000` with the frontend expected at `http://localhost:5173` (Vite default).
