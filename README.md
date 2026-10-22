# Ambient Sound Studio

Ambient Sound Studio is a vanilla Web Audio soundscape mixer for rain, coffee
shop, and fireplace layers. The app works fully in guest mode. Signed-in users
can save, browse, apply, rename, and delete custom soundscape mixes across visits.

## Setup

1. Install Node.js 20 or newer and MongoDB.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in the required values:

   ```text
   MONGODB_URI=
   SESSION_SECRET=
   NODE_ENV=development
   PORT=3000
   ```

   `SESSION_SECRET` must be at least 32 characters. `PROVIDER`,
   `GEMINI_API_KEY`, `GEMINI_MODEL`, and `MIX_MOCK` are optional. If the Gemini
   values are absent, `/api/mix` uses the keyword fallback. Set `MIX_MOCK=1`
   to force that fallback.

4. Start the app:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>. Production uses `npm start`.

The server validates required environment variable names at startup and never
prints their values. `GET /api/health` reports `{ "ok": true }` and the
MongoDB connection state.

## Front end and audio preparation

The browser application lives in `public/`. Audio files are served only from
`public/sounds/`; the project root is never exposed by Express. To prepare raw
audio, write output under the public directory:

```bash
./prep.sh raw/rain public/sounds/rain
```

Keep `raw/` out of version control. Edit
[public/js/config/soundscapes.js](public/js/config/soundscapes.js) to add
layers. The audio engine and its guest-mode behavior do not depend on
authentication.

## Saved mixes

Signed-in users can manage up to 50 custom mixes from the "My mixes" panel in the
header or save an AI-generated mood mix directly:

- **Panel**: Slide-in dialog with labelled controls, focus trap, and Escape dismissal.
- **Save current mix**: Reads live channel and layer volumes from the store (master volume is deliberately not saved).
- **Apply mix**: Animates channel and layer sliders to the saved balance over ~1.5s using smoothed gain setters; any layer at 0 remains completely silent with zeroed drift.
- **Rename & Delete**: Inline renaming and two-step confirmation on deletion.
- **AI mix integration**: Successful AI mood mixes display a "Save this mix" button pre-filling the title and marking source as `"ai"`.
- **Guest mode**: "My mixes" and "Save this mix" buttons remain visible for guests; clicking prompts the user to sign in without interrupting audio playback or throwing uncaught errors.

### API Endpoints (`/api/mixes`)

All endpoints require active session authentication (`requireAuth`):

- `GET /api/mixes`: Lists the user's saved mixes, newest first.
- `POST /api/mixes`: Creates a mix (max 50 per user; returns `409 Conflict` beyond that). Maximum body size is 8 KB. Validates channels and layers with Zod against the soundscape catalog, requiring levels from 0 to 1 and rejecting unknown or extra fields.
- `PATCH /api/mixes/:id`: Renames a mix (1-40 characters).
- `DELETE /api/mixes/:id`: Removes a mix.

Every operation filters strictly by `{ _id, userId }` using the session's `userId`. Any non-matching mix or invalid ObjectId returns `404 Not Found` to prevent cross-user ID probing. Rate limiting permits 60 requests per minute per user on `/api/mixes`.

## Security choices

- Passwords are hashed with Argon2id and are never returned.
- Login uses a dummy hash for unknown emails and returns one generic failure
  message for both unknown users and wrong passwords.
- Sessions use MongoDB storage, a 14-day `ass.sid` httpOnly cookie, SameSite
  lax, and secure cookies in production. Login regenerates the session.
- State-changing requests require JSON and a same-origin Origin or Referer.
- API, registration, login, and mix rate limits are enabled.
- Helmet sends a Content-Security-Policy allowing only same-origin scripts,
  audio, connections, and styles. No inline styles or scripts are required.
- Error responses are generic and server logs never contain request bodies,
  passwords, email addresses, user text, or API keys.

## Smoke tests

Run the authentication smoke test against a running server with a reachable MongoDB:

```bash
npm run smoke:auth
```

Run the saved mixes smoke test (tests guest 401s, creation, listing, renaming, deletion, Zod validation rejections, payload limits, and cross-user isolation):

```bash
npm run smoke:mixes
```

## AI mood mixer

`POST /api/mix` accepts a 200-character description and the channel/layer
catalog, validates and clamps the response, includes `source` and `latencyMs`,
and applies a 20-second upstream timeout. Gemini is called only on the server
with `x-goog-api-key`; the browser never receives the key. If Gemini is
rate-limited, unavailable, or times out, the server returns a local keyword mix
with `source: "keyword"` and a safe `fallbackReason`, so the audio experience
continues without an error state.

The previous Netlify function, `netlify.toml`, and Vercel adapter were removed;
the Express server is now the single same-origin application server.

## Deployment

Deploy to a Node.js host that can run `npm start` and reach MongoDB over the
network. Set the environment variables in the host's secret configuration,
including a production `NODE_ENV` and a strong `SESSION_SECRET`. When the host
is behind one trusted reverse proxy, Express uses `trust proxy` in production
so secure cookies work correctly. Restrict MongoDB network access to the
deployment host or its private network, and terminate HTTPS at the host or
trusted proxy.
