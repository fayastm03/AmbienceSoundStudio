# Data Model

Ambient Sound Studio uses MongoDB via Mongoose. The database stores user accounts,
sessions, and user-saved soundscape mixes. Future personalization collections
remain planned.

---

## Active Collections

### `users` (Model `User`)

- `email` (string, required, unique, lowercase, trimmed)
- `passwordHash` (string, required, select: false, hashed with Argon2id)
- `displayName` (string, optional, trimmed, max 40 chars)
- `createdAt` (date, default: `Date.now`)
- `lastLoginAt` (date, default: `null`)
- `consent.personalization` (boolean, default: `false`)
- `consent.updatedAt` (date, default: `Date.now`)

### `savedmixes` (Model `SavedMix`)

Stores per-user soundscape mixes. Each mix captures channel and individual layer
gain levels (0 to 1). Master volume is deliberately **excluded** to respect the
listener's playback device setting.

- `userId` (ObjectId, required, indexed, references `User`)
- `name` (string, required, trimmed, 1 to 40 characters)
- `levels` (Mixed object, strictly validated with Zod against the soundscape catalog):
  ```json
  {
    "<channelId>": {
      "channel": 0.0 - 1.0,
      "layers": {
        "<layerId>": 0.0 - 1.0
      }
    }
  }
  ```
- `source` (string, enum: `"manual"`, `"ai"`, default: `"manual"`)
- `createdAt` (date, auto-managed timestamps)
- `updatedAt` (date, auto-managed timestamps)

**Indexes**:
- Compound index: `{ userId: 1, createdAt: -1 }` (optimizes sorted per-user listing).
- Single index: `userId: 1` (on `userId` field).

**Rules & Constraints**:
- Maximum of 50 saved mixes per user (POST returns `409 Conflict` when exceeded).
- Ownership isolation: `userId` always originates from `req.session.userId`.
- Read, update, and delete queries strictly query `{ _id, userId }`. Non-matches and invalid ObjectIds return `404 Not Found` to prevent ID enumeration.
- Request payloads are limited to 8 KB and strictly reject unexpected keys.

---

## Future Collections (Planned)

### `listeningEvents`

- `userId` (ObjectId, required, indexed)
- `startedAt` (date, required, indexed)
- `durationSec` (number, bounded and non-negative)
- `levels` (snapshot of channel and layer volumes)
- `moodTags` (array of strings, optional)
- `timeOfDay` (derived or submitted time bucket)
- `consent` (boolean or consent version recorded at event creation)

Recommended indexes: `{ userId: 1, startedAt: -1 }`. Mood tags are sensitive
personalization data and must not be collected unless the user has explicitly
consented. Users must be able to export and delete their listening data.

### `profileSummary`

A derived per-user document containing aggregate preferences, such as frequently
used channels, preferred volume ranges, and time-of-day patterns. It should be
rebuildable from source events, should not be treated as the source of truth,
and must be deleted or recomputed when source data or consent changes.

Recommended unique index: `{ userId: 1 }`.
