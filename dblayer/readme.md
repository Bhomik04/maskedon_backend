# Database Layer (`dblayer/`)

The data-access layer for the maskedon platform. This module owns every interaction with the PostgreSQL database — connection pooling, schema definitions, migrations, seeding, and all query functions consumed by the API controllers.

---

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| PostgreSQL | 14+ | Relational database |
| pg | 8.x | Async PostgreSQL driver |
| dotenv | 17.3.1 | Environment variable loading |
| bcrypt | 6.0.0 | Password hashing (used in seed) |
| uuid | 13.0.0 | UUID v4 generation for primary keys |

---

## Directory Structure

```
dblayer/
├── connection.ts          # Pool creation, query helper, typeCast config
├── schema.sql             # Full DDL for all 11 tables
├── migrate.ts             # Migration runner (reads schema.sql, tracks in migrations table)
├── seed.ts                # Inserts sample users & a test event
├── index.ts               # Barrel export — re-exports everything
├── user-queries.ts        # User CRUD & profile operations
├── event-queries.ts       # Event CRUD, discovery filters, attendee counts
├── request-queries.ts     # Join request lifecycle (create → approve/reject/withdraw)
├── payment-queries.ts     # Mock payment creation & status updates
├── rating-queries.ts      # Rating CRUD, average calculation, per-user history
├── photo-queries.ts       # Photo CRUD, likes, soft delete
├── notification-queries.ts # Notification CRUD, mark-read, unread count
├── friend-queries.ts      # Friendship lifecycle, mutual friends, friend list
└── readme.md              # This file
```

---

## Connection & Pool (`connection.ts`)

Creates a PostgreSQL pool configured from environment variables:

```
DATABASE_URL (preferred)
DB_POOL_MAX  (default: 20)
```

Fallback variables when `DATABASE_URL` is not set:

```
DB_HOST      (default: localhost)
DB_PORT      (default: 5432)
DB_NAME      (default: maskedon)
DB_USER      (default: postgres)
DB_PASSWORD  (default: "")
```

**Key configuration:**

- **Connection limit:** 20 concurrent connections
- **Compatibility layer:** Existing SQL with `?` placeholders is converted to PostgreSQL `$1`, `$2` parameters
- **Type parsing:** `NUMERIC` and `BIGINT` are parsed to JavaScript `Number` to preserve existing query behavior

**Exports:**

| Export | Description |
|--------|-------------|
| `query<T>(sql, params?)` | Runs a query and returns `{ rows, affectedRows, insertId }` |
| `getConnection()` | Acquires a raw connection from the pool (for transactions) |
| `testConnection()` | Pings the database and logs connection status |
| `default` (pool) | The raw `pg` pool instance |

---

## Database Schema (`schema.sql`)

11 tables designed for PostgreSQL (Supabase-compatible):

### Core Tables

| Table | Primary Key | Purpose |
|-------|------------|---------|
| `users` | `UUID` | User accounts, profiles, rating aggregates |
| `events` | `UUID` | Event events with location, capacity, pricing, status |
| `event_requests` | `UUID` | Join requests from users to events |
| `event_attendees` | `UUID` | Confirmed attendees (approved + paid) |
| `payments` | `UUID` | Mock payment records |

### Social Tables

| Table | Primary Key | Purpose |
|-------|------------|---------|
| `ratings` | `UUID` | Post-event attendee ratings (1-5 scale) |
| `photos` | `UUID` | User/event photos (Supabase URLs) |
| `photo_likes` | `UUID` | Many-to-many like associations |
| `friendships` | `UUID` | Friend requests & accepted friendships |

### System Tables

| Table | Primary Key | Purpose |
|-------|------------|---------|
| `notifications` | `UUID` | In-app notification system |
| `refresh_tokens` | `UUID` | Hashed JWT refresh tokens for session management |

### Key Constraints & Rules

- **No self-rating:** `CHECK (rater_id != rated_id)` on `ratings`
- **No self-friending:** `CHECK (requester_id != addressee_id)` on `friendships`
- **One request per user per event:** `UNIQUE (event_id, user_id)` on `event_requests`
- **One rating per pair per event:** `UNIQUE (rater_id, rated_id, event_id)` on `ratings`
- **One like per user per photo:** `UNIQUE (photo_id, user_id)` on `photo_likes`
- **Unique friendship pair:** `UNIQUE (requester_id, addressee_id)` on `friendships`
- **Cascading deletes** on all foreign keys referencing `users` and `events`
- **Soft deletes** on `users`, `events`, and `photos` via `deleted_at` timestamp

### Event Status Lifecycle

```
upcoming → ongoing → completed → archived
    ↓ (at any point)
  cancelled
```

---

## Query Modules

Each module exports pure async functions that accept parameters and return typed results. No HTTP or Express logic — only SQL.

### `user-queries.ts`
- `createUser(id, email, username, passwordHash, displayName)` — INSERT new user
- `findByEmail(email)` — Lookup by email (for login)
- `findByUsername(username)` — Lookup by username
- `findById(id)` — Lookup by UUID
- `updateProfile(id, fields)` — Partial update (display_name, bio, avatar_url)
- `updateSocialRating(id, rating, totalRatings)` — Set computed rating values
- `incrementEventsHosted(id)` / `incrementEventsAttended(id)` — Counter bumps

### `event-queries.ts`
- `createEvent(...)` — INSERT with all event fields
- `findEventById(id)` — Single event with host details (JOIN)
- `listEvents(filters)` — Paginated discovery with optional city, status, date, price, tag filters
- `updateEvent(id, fields)` — Partial update
- `deleteEvent(id)` — Soft delete
- `incrementAttendees(id)` / `decrementAttendees(id)` — Counter management
- `getEventsByHost(hostId)` — All events for a host (dashboard)
- `getAttendees(eventId)` — List confirmed attendees with user details

### `request-queries.ts`
- `createRequest(id, eventId, userId, message?)` — Submit join request
- `findRequest(eventId, userId)` — Check existing request
- `findRequestById(id)` — Lookup by request ID
- `updateRequestStatus(id, status)` — Approve/reject/withdraw
- `getRequestsByEvent(eventId)` — All requests for a event (host view)
- `getRequestsByUser(userId)` — User's sent requests

### `payment-queries.ts`
- `createPayment(id, payerId, hostId, eventId, amount, currency)` — Record mock payment
- `completePayment(id, transactionId)` — Mark as completed
- `findPaymentById(id)` — Lookup
- `refundPayment(id)` — Mark as refunded

### `rating-queries.ts`
- `createRating(id, raterId, ratedId, eventId, score, comment?)` — Submit rating
- `findRating(raterId, ratedId, eventId)` — Check if already rated
- `getRatingsForUser(userId)` — All ratings received (for algorithm)
- `getRatingsForEvent(eventId)` — All ratings given at a event
- `getAverageRating(userId)` — Raw SQL average computation

### `photo-queries.ts`
- `createPhoto(id, userId, eventId?, imageUrl, caption?)` — Upload record
- `findPhotoById(id)` — Lookup
- `getPhotosByUser(userId)` — User's gallery
- `getPhotosByEvent(eventId)` — Event album
- `softDeletePhoto(id)` — Set `deleted_at`
- `toggleLike(photoId, userId)` — Upsert/delete like + update counter
- `hasUserLiked(photoId, userId)` — Check like status

### `notification-queries.ts`
- `createNotification(id, userId, type, title, body?, referenceId?, referenceType?)` — Insert
- `getNotifications(userId, limit?, offset?)` — Paginated list
- `markAsRead(id, userId)` — Mark one as read
- `markAllAsRead(userId)` — Mark all as read
- `getUnreadCount(userId)` — Count for badge display

### `friend-queries.ts`
- `createFriendRequest(id, requesterId, addresseeId)` — Send request
- `findFriendship(userA, userB)` — Check existing friendship (either direction)
- `acceptFriendRequest(id)` — Accept
- `rejectFriendRequest(id)` — Reject
- `removeFriendship(id)` — Unfriend (hard delete)
- `getUserFriends(userId, limit?, offset?)` — Paginated friend list with user details
- `getPendingRequests(userId)` — Incoming pending requests
- `getFriendCount(userId)` — Total accepted friends
- `getMutualFriends(userA, userB)` — Shared friends between two users

---

## Barrel Export (`index.ts`)

All query functions and connection helpers are re-exported from `index.ts`, so the API layer imports from a single entry point:

```typescript
import { query, findEventById, createNotification } from "@dblayer";
```

The `@dblayer` path alias is configured in `tsconfig.json` → `"@dblayer/*": ["dblayer/*"]`.

---

## Migrations (`migrate.ts`)

Reads `schema.sql`, splits on semicolons, and executes each statement in a transaction. Tracks applied migrations in a `migrations` table to prevent re-execution.

**Run:**
```bash
npm run migrate
```

---

## Seeding (`seed.ts`)

Inserts 3 test users (password: `password123`) and 1 test event (Bangalore, 1 week from now):

```bash
npm run seed
```

Test accounts:
| Email | Username | Display Name |
|-------|----------|-------------|
| riya@example.com | riya_hosts | Riya Sharma |
| arjun@example.com | arjun_explorer | Arjun Patel |
| meera@example.com | meera_snaps | Meera Kapoor |

---

## Date/Time Handling

PostgreSQL accepts ISO timestamps directly. The existing datetime helper remains supported but can be simplified in future cleanup.
