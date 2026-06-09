-- maskedon Database Schema
-- Version: 2.0.0
-- Database: PostgreSQL (Supabase-compatible)

-- ============================================
-- USERS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    bio TEXT,
    avatar_url VARCHAR(500),
    social_rating NUMERIC(3,2) DEFAULT 0.00,
    total_ratings INT DEFAULT 0,
    events_hosted INT DEFAULT 0,
    events_attended INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ============================================
-- EVENTS
-- ============================================
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY,
    host_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    location_name VARCHAR(300) NOT NULL,
    location_city VARCHAR(100) NOT NULL,
    latitude NUMERIC(10,8),
    longitude NUMERIC(11,8),
    date_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NULL,
    max_capacity INT NOT NULL,
    current_attendees INT DEFAULT 0,
    ticket_price INT DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'INR',
    cover_image_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'upcoming',
    tags JSONB,
    min_rating NUMERIC(3,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT fk_events_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_events_status CHECK (status IN ('upcoming', 'ongoing', 'completed', 'cancelled', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_events_host ON events (host_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_city ON events (location_city);
CREATE INDEX IF NOT EXISTS idx_events_datetime ON events (date_time);

-- ============================================
-- EVENT REQUESTS
-- ============================================
CREATE TABLE IF NOT EXISTS event_requests (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    message TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL,
    CONSTRAINT uq_event_user UNIQUE (event_id, user_id),
    CONSTRAINT fk_requests_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_event_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'))
);

CREATE INDEX IF NOT EXISTS idx_event_requests_event ON event_requests (event_id);
CREATE INDEX IF NOT EXISTS idx_event_requests_user ON event_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_event_requests_status ON event_requests (status);

-- ============================================
-- PAYMENTS (MOCK)
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY,
    payer_id UUID NOT NULL,
    host_id UUID NOT NULL,
    event_id UUID NOT NULL,
    amount INT NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    status VARCHAR(20) DEFAULT 'pending',
    mock_transaction_id VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    CONSTRAINT fk_payments_payer FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_payments_host FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_payments_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT chk_payments_status CHECK (status IN ('pending', 'completed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments (payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_event ON payments (event_id);

-- ============================================
-- EVENT ATTENDEES
-- ============================================
CREATE TABLE IF NOT EXISTS event_attendees (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    user_id UUID NOT NULL,
    payment_id UUID NULL,
    checked_in BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attendee_event_user UNIQUE (event_id, user_id),
    CONSTRAINT fk_attendees_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_attendees_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_attendee_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_event_attendees_event ON event_attendees (event_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_user ON event_attendees (user_id);

-- ============================================
-- CROWD RATINGS (post-event crowd/vibe rating)
-- ============================================
CREATE TABLE IF NOT EXISTS crowd_ratings (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    event_id UUID NOT NULL,
    score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_crowd_rating_user_event UNIQUE (user_id, event_id),
    CONSTRAINT fk_crowd_ratings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_crowd_ratings_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crowd_ratings_event ON crowd_ratings (event_id);
CREATE INDEX IF NOT EXISTS idx_crowd_ratings_user ON crowd_ratings (user_id);

-- ============================================
-- PHOTOS
-- ============================================
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    event_id UUID NULL,
    image_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    caption VARCHAR(500),
    like_count INT DEFAULT 0,
    view_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT fk_photos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_photos_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_user ON photos (user_id);
CREATE INDEX IF NOT EXISTS idx_photos_event ON photos (event_id);

-- ============================================
-- PHOTO LIKES
-- ============================================
CREATE TABLE IF NOT EXISTS photo_likes (
    id UUID PRIMARY KEY,
    photo_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_photo_user_like UNIQUE (photo_id, user_id),
    CONSTRAINT fk_likes_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_likes_photo ON photo_likes (photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_likes_user ON photo_likes (user_id);

-- ============================================
-- PHOTO COMMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS photo_comments (
    id UUID PRIMARY KEY,
    photo_id UUID NOT NULL,
    user_id UUID NOT NULL,
    comment_text TEXT NOT NULL,
    like_count INT DEFAULT 0,
    parent_comment_id UUID NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    CONSTRAINT fk_comments_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_comment_parent FOREIGN KEY (parent_comment_id) REFERENCES photo_comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_comments_photo ON photo_comments (photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_comments_user ON photo_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_photo_comments_parent ON photo_comments (parent_comment_id);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    reference_id UUID NULL,
    reference_type VARCHAR(50),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, is_read);

-- ============================================
-- USER ACHIEVEMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS user_achievements (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key VARCHAR(80) NOT NULL,
    achievement_name VARCHAR(120) NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_achievement UNIQUE (user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements (user_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked_at ON user_achievements (unlocked_at DESC);

-- ============================================
-- REFRESH TOKENS (for JWT auth)
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- ============================================
-- FRIENDSHIPS
-- ============================================
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY,
    requester_id UUID NOT NULL,
    addressee_id UUID NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_friendship_pair UNIQUE (requester_id, addressee_id),
    CONSTRAINT fk_friendships_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_friendships_addressee FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_no_self_friend CHECK (requester_id <> addressee_id),
    CONSTRAINT chk_friendships_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships (status);

-- ============================================
-- USER BLOCKS
-- ============================================
CREATE TABLE IF NOT EXISTS user_blocks (
    id UUID PRIMARY KEY,
    blocker_id UUID NOT NULL,
    blocked_user_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_block_pair UNIQUE (blocker_id, blocked_user_id),
    CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks (blocked_user_id);

-- ============================================
-- PHOTO VIEWS (migration 004)
-- ============================================
CREATE TABLE IF NOT EXISTS photo_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID NOT NULL,
    user_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_photo_user_view UNIQUE (photo_id, user_id),
    CONSTRAINT fk_photo_views_photo FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    CONSTRAINT fk_photo_views_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_views_photo ON photo_views (photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_views_user ON photo_views (user_id);

-- ============================================
-- DEVICE PUSH TOKENS (migration 005)
-- ============================================
CREATE TABLE IF NOT EXISTS device_push_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_platform CHECK (platform IN ('fcm', 'apns')),
    CONSTRAINT uq_push_token UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON device_push_tokens (user_id);

-- ============================================
-- REPORTS (migration 006)
-- ============================================
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(20) NOT NULL,
    target_id UUID NOT NULL,
    reason VARCHAR(50) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_report_target_type CHECK (target_type IN ('user', 'event', 'photo')),
    CONSTRAINT chk_report_reason CHECK (reason IN ('spam','harassment','fake_event','inappropriate_content','underage','other')),
    CONSTRAINT chk_report_status CHECK (status IN ('open','reviewed','resolved','dismissed')),
    CONSTRAINT uq_report_per_user UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);

-- ============================================
-- USER TAG AFFINITIES (migration 011)
-- Cached per-user tag affinity scores from engagement history
-- ============================================
CREATE TABLE IF NOT EXISTS user_tag_affinities (
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag              TEXT NOT NULL,
    affinity_score   NUMERIC(10,4) NOT NULL DEFAULT 0,
    interaction_count INT NOT NULL DEFAULT 0,
    last_interaction_at TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_user_tag_affinities_score ON user_tag_affinities (user_id, affinity_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_tag_affinities_tag ON user_tag_affinities (tag);

-- ============================================
-- DISCOVERY IMPRESSIONS (migration 011)
-- Tracks which discovery posts have been shown to each user
-- ============================================
CREATE TABLE IF NOT EXISTS discovery_impressions (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    photo_id  UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    shown_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    engaged   BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (user_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_impressions_shown ON discovery_impressions (shown_at);
CREATE INDEX IF NOT EXISTS idx_discovery_impressions_user ON discovery_impressions (user_id, shown_at DESC);

-- ============================================
-- MIGRATION TRACKER (used by npm run migrate:all)
-- ============================================
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
