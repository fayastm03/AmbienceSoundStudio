# Ambient Sound Studio

A vanilla Web Audio soundscape mixer for rain, coffee shop, and fireplace layers.

## Run

From the project directory, run `python3 -m http.server 8000`, then open <http://localhost:8000>.

## Structure

- `index.html` - application shell
- `css/` - base, theme, layout, and component styles
- `js/` - audio, UI, configuration, and state modules
- `sounds/` - prepared loop-ready MP3 files

Features include layered playback, procedural fallbacks, per-layer controls, saved settings, Light/Dark/Auto themes, mood-tinted but contrast-safe colours, keyboard shortcuts, responsive detail panels, reduced-motion support, natural drift, random loop offsets, stereo panning, calibrated `gainDb` trims, and a debug overlay at `?debug=1`.

## AI mood mixer

The mood mixer sends the 200-character description and the channel/layer catalog from `js/config/soundscapes.js` to `/api/mix`. It validates and clamps the response, animates the result over two seconds, and falls back to local keyword presets for sleep, focus, reading, calm, cosy, and storm. Requests have a three-second client cooldown.

The shared server function is [netlify/functions/mix.js](netlify/functions/mix.js). Netlify runs it directly, while [api/mix.js](api/mix.js) adapts the same handler for Vercel. It uses Google Gemini by default. Create a key at <https://aistudio.google.com/> and set these variables:

```text
PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=
MIX_MOCK=
```

`GEMINI_MODEL` is required when calling the real API; there is intentionally no hardcoded model name. Set `MIX_MOCK=1` to test without a key. The key is sent only from the server in the `x-goog-api-key` header and is never sent to the browser. See [.env.example](.env.example) for the empty local template.

For local testing, use Netlify Dev so `/api/mix` routes to the function. If your Netlify CLI version does not automatically import `.env`, export the values in the same shell before starting it:

```bash
set -a
source .env
set +a
npx netlify-cli dev
```

Netlify CLI prints the local port it selected (commonly `8888`); open that printed URL rather than the static `python3 -m http.server` port. Set the variables in the Netlify dashboard, or in a local uncommitted `.env` file:

```text
PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=your-model-name
MIX_MOCK=0
```

The function logs only whether `PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `MIX_MOCK` are set or missing. It never logs their values or the user's prompt.

The server waits up to 20 seconds for Gemini, but Netlify's synchronous function timeout depends on the site's plan/runtime and may be shorter. A platform timeout can therefore end the request before the application timeout; the client has a separate 25-second abort.

The request uses `thinkingConfig`: `thinkingBudget: 0` for non-Gemini-3 model names and `thinkingLevel: "minimal"` for Gemini-3 model names. Google documents these controls for different model generations; support for the user-supplied `gemini-3.5-flash` name specifically should be confirmed against the model's current API metadata. The response parser ignores parts marked `thought` and concatenates the remaining text parts.

Google's free-tier terms may allow prompts sent to some Gemini products to be used to improve Google products. Review the current Google AI Studio/Gemini privacy and data-use terms before sending sensitive text.

### If the API is rate-limited

The function allows about eight requests per IP per minute as a best-effort in-memory limit. Gemini HTTP 429 responses return `AI is busy, try again in a minute`; the client then uses its local keyword mixer and displays `AI is busy, using quick mode`. This serverless memory limit is not a durable global rate limiter, so use platform controls for production enforcement.

Deploy by linking the project with `netlify init` and running `netlify deploy --prod`, or connect the repository in Netlify. Set the same variables in the Netlify dashboard and keep `.env` out of version control.

### Vercel deployment

For Vercel, the `/api/mix` entry point is [api/mix.js](api/mix.js). Add `PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, and `MIX_MOCK=0` under the Vercel project’s **Settings → Environment Variables** for the **Production** environment, then redeploy. Vercel does not read your local `.env` file during a Git deployment, and `.env` must remain uncommitted.

## Tuning

Edit only [js/config/soundscapes.js](js/config/soundscapes.js) to add layers. `gainDb` is a fixed per-layer trim applied before the layer volume; use it to make sparse sounds sit behind dense ambience. `pan` is the stereo position from `-1` (left) to `1` (right). The prepared MP3 files in `sounds/` are loop-ready and should not be re-encoded.
