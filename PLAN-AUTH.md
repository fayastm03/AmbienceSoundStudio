# Authentication implementation plan

## Target layout

```text
.
├── public/
│   ├── index.html
│   ├── css/
│   ├── js/
│   │   ├── api/client.js
│   │   └── ui/auth.js
│   ├── sounds/
│   └── assets/
├── server/
│   ├── config/{env,db}.js
│   ├── middleware/{requireAuth,rateLimit,errorHandler,sameOrigin}.js
│   ├── models/User.js
│   ├── routes/{auth,mix,health}.js
│   ├── services/gemini.js
│   └── index.js
├── scripts/smoke-auth.mjs
├── raw/
├── tools/
├── prep.sh
├── package.json
├── .env.example
├── DATA-MODEL.md
└── README.md
```

The Express static root will be `public/` only. Guest playback and the existing
audio engine remain in the browser; authentication adds session-backed identity
and does not gate the soundscape.

## Dependencies

Runtime dependencies:

- `express`
- `mongoose`
- `dotenv`
- `express-session`
- `connect-mongo`
- `argon2` (with `bcryptjs` at cost 12 as the install fallback)
- `helmet`
- `express-rate-limit`
- `zod`

## Files to move

- `index.html` -> `public/index.html`
- `css/` -> `public/css/`
- `js/` -> `public/js/`
- `sounds/` -> `public/sounds/`
- `assets/` -> `public/assets/` if present

## Files to create

- `package.json`
- `.env.example`
- `server/index.js`
- `server/config/env.js`
- `server/config/db.js`
- `server/models/User.js`
- `server/routes/auth.js`
- `server/routes/mix.js`
- `server/routes/health.js`
- `server/middleware/requireAuth.js`
- `server/middleware/rateLimit.js`
- `server/middleware/errorHandler.js`
- `server/middleware/sameOrigin.js`
- `server/services/gemini.js`
- `scripts/smoke-auth.mjs`
- `public/js/api/client.js`
- `public/js/ui/auth.js`
- `DATA-MODEL.md`

## Files to delete

- `netlify/functions/mix.js`
- `netlify.toml`
- `api/mix.js`
- `netlify/` after its contents are removed

The local `.netlify/` directory is generated state and will not be part of the
Express application. Existing source files under `raw/`, `tools/`, and
`prep.sh` remain at the repository root.

## Risks and mitigations

- MongoDB availability can prevent startup or make health report a disconnected
  state; connection errors will be explicit while guest static playback remains
  usable once the server is running.
- Session cookies require a strong secret, HTTPS, and correct proxy trust in
  production; startup validation and secure cookie settings will enforce this.
- Authentication timing and session fixation risks will be addressed with a
  dummy password hash, Argon2id, and session regeneration on login.
- Same-origin checks, JSON-only state changes, Helmet CSP, and API rate limits
  reduce browser CSRF and abuse risk without requiring a token in local storage.
- The Gemini integration may be unavailable or unconfigured; the mix endpoint
  will retain its local keyword fallback and preserve the existing validation,
  clamping, timeout, and response metadata behavior.
- Moving static paths can break relative references or prep output paths; asset
  references and README/prep usage will be updated and checked.
- Existing uncommitted edits in `css/components.css`, `css/themes.css`, and
  `js/ui/theme.js` must be preserved while adding the auth UI.
