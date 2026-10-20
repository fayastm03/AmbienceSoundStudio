# AI mood mixer audit

Audit completed before implementation changes.

| File | Line | Severity | Bug/risk | Fix |
| --- | ---: | --- | --- | --- |
| `netlify/functions/mix.js` | 22 | blocker | The server still reads the OpenAI key and calls the OpenAI API, so the requested Gemini provider is not implemented. | Add provider selection with Gemini as the default and isolate provider request/response helpers. |
| `netlify/functions/mix.js` | 31-51 | blocker | The request shape is OpenAI-specific (`messages`, `response_format`, `max_tokens`) and cannot produce the required Gemini `generateContent` request. | Use Gemini `systemInstruction`, `contents`, `generationConfig.responseMimeType`, `responseSchema`, and `maxOutputTokens`. |
| `netlify/functions/mix.js` | 22 | major | Missing key/model configuration is not distinguished clearly; the current model has a hardcoded fallback. | Require `GEMINI_API_KEY` and `GEMINI_MODEL` unless `MIX_MOCK=1`, and return a generic clear 500 error. |
| `netlify/functions/mix.js` | 24-58 | major | There is no timeout, 429 mapping, blocked-response handling, strict output sanitization, length limits, or best-effort per-IP rate limit. | Add a 10-second timeout, 429/504 responses, validation/clamping, generic errors, and an in-memory IP window. |
| `netlify/functions/mix.js` | 28-35 | major | User text is interpolated into the model prompt without an explicit instruction/data boundary or prompt-injection rule. | Tell the model that user text is data, ignore instructions inside it, and return only the schema. |
| `.env` | 1-4 | blocker | A local environment file contains a provider credential. It is ignored by Git, but the credential should be rotated if it has been exposed outside the local machine. | Do not copy it into client code or logs; use `.env.example` with empty values and rotate the credential if necessary. |
| `netlify.toml` | 1-7 | minor | Routing is present for `/api/mix`, but provider setup and mock-mode behavior are undocumented. | Keep the route and document Netlify Dev/deployment environment variables. |
| `js/ui/mood-mixer.js` | 72-108 | major | The client has no abort timeout; a hung API request can leave the button disabled/loading indefinitely. | Use an `AbortController` timeout and always restore the button/loading state in `finally`. |
| `js/ui/mood-mixer.js` | 84-99 | major | The client falls back on errors, but does not distinguish busy/server failures with the required plain-language message. | Use “AI is busy, using quick mode” for server/network failures and retain local keyword fallback. |
| `js/ui/mood-mixer.js` | 30-45 | major | Client sanitization clamps known IDs but does not explicitly remove unknown IDs before constructing the result; name/explanation limits are too long. | Construct output only from the config catalog and cap name at 40 and explanation at 160 characters. |
| `js/ui/mood-mixer.js` | 47-73 | major | Mood animation writes state directly while calling engine setters, but there is no explicit mix transaction for undo. The existing app has no undo feature to preserve. | Preserve the existing persisted state semantics; avoid adding a separate undo stack and keep each animated result as normal slider state. |
| `js/ui/mood-mixer.js` | 47-73 | major | A zero target is numerically produced, but the animation path depends on the engine being initialized and does not independently assert zero silence. | Continue using the engine’s zero-safe setters and ensure every target is clamped to exactly `0` before animation. |
| `js/ui/mood-mixer.js` | 84-108 | minor | Cooldown is timestamp-based and generally resets correctly, but there is no explicit UI loading state separate from button disabled state. | Set a clear loading label and restore it in `finally`; keep the timestamp cooldown independent of request completion. |
| `js/ui/mood-mixer.js` | 92 | minor | The catalog is correctly read from `configs`, not hardcoded, but the request has no client-side response schema validation beyond the loose `levels` check. | Validate object shape and sanitize only configured IDs. |

## Required security observations

- Existing client code uses `textContent` for status and explanation; it does not insert model output with `innerHTML`.
- The new implementation must preserve that rule and must never expose a provider key to browser JavaScript.
- The current local `.env` was inspected only to verify configuration names; its credential value is not reproduced here.

## Gemini API field verification

The official Gemini `generateContent` API uses:

- `systemInstruction`
- `contents`
- `generationConfig`
- `responseMimeType`
- `responseSchema`
- `maxOutputTokens`
- `temperature`
- `candidates[0].content.parts[0].text`
- `promptFeedback` for blocked prompts

The requested endpoint form is:

`/v1beta/models/<GEMINI_MODEL>:generateContent`

The API key can be supplied using the `x-goog-api-key` request header. These differ from the current OpenAI fields and will be implemented accordingly.
