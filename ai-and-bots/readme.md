# AI & Bots (`ai-and-bots/`)

Reserved module for future artificial intelligence and bot-related features on the maskedon platform. Currently a placeholder — no production code lives here yet.

---

## Purpose

This directory will house machine learning models, bot detection systems, and intelligent automation features as the platform evolves. Keeping it as a dedicated module from the start ensures a clean separation of concerns when AI functionality is introduced.

---

## Planned Features

### Bot & Fake Account Detection
- Behavioral analysis to detect bot-like activity (mass requests, suspicious timing patterns)
- Account verification scoring based on profile completeness and activity patterns
- Automated flagging of accounts that exhibit inauthentic behavior

### Smart Party Matching
- Recommendation engine that suggests parties based on user preferences, past attendance, social connections, and rating history
- Collaborative filtering: "users like you also attended..."
- Location-aware suggestions using party geolocation data

### Content Moderation
- Automated screening of party descriptions, messages, and photo captions
- Toxicity detection for ratings and comments
- Image moderation for uploaded photos

### Social Graph Analysis
- Community detection within the friendship network
- Influence scoring based on social connections and activity
- Party success prediction based on host rating, historical attendance, and social reach

---

## Architecture Guidelines

When implementing features in this module:

1. **Pure logic only** — Like `algorithms/`, this module should contain no Express/HTTP code and no direct database queries
2. **Interface-driven** — Define clear input/output types consumed by the API controllers
3. **Stateless** — Functions should be pure where possible; any model state (trained weights, etc.) should be loaded from external storage
4. **Path alias** — Import via `@ai` as configured in `tsconfig.json` (`"@ai/*": ["ai-and-bots/*"]`)

---

## Directory Structure (Planned)

```
ai-and-bots/
├── bot-detection/       # Fake account & bot analysis
├── recommendations/     # Party matching & suggestions
├── moderation/          # Content screening
├── social-graph/        # Network analysis utilities
└── readme.md            # This file
```
