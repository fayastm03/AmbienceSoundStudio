# Ambient Sound Studio audit

Audit performed before implementation changes. The `sounds/` tree contains all ten requested MP3s with matching lowercase paths:

| Configured path | On disk | Result |
| --- | --- | --- |
| `sounds/rain/heavy-rain.mp3` | `sounds/rain/heavy-rain.mp3` | exact match |
| `sounds/rain/light-rain.mp3` | `sounds/rain/light-rain.mp3` | exact match |
| `sounds/rain/window.mp3` | `sounds/rain/window.mp3` | exact match |
| `sounds/rain/roof.mp3` | `sounds/rain/roof.mp3` | exact match |
| `sounds/rain/thunder.mp3` | `sounds/rain/thunder.mp3` | exact match |
| `sounds/cafe/chatter.mp3` | `sounds/cafe/chatter.mp3` | exact match |
| `sounds/cafe/espresso.mp3` | `sounds/cafe/espresso.mp3` | exact match |
| `sounds/fireplace/crackle.mp3` | `sounds/fireplace/crackle.mp3` | exact match |
| `sounds/fireplace/firewood.mp3` | `sounds/fireplace/firewood.mp3` | exact match |
| `sounds/fireplace/embers.mp3` | `sounds/fireplace/embers.mp3` | exact match |

## Findings

| File and line | Severity | Root cause | Planned fix |
| --- | --- | --- | --- |
| `js/audio/loader.js:6` | major | `fetch()` and `decodeAudioData()` are both inside one silent `catch`; HTTP status, URL, and decode error are discarded. The config paths for Coffee Shop and Fireplace exactly match the real files, so the browser tag cannot be attributed to a spelling or case mismatch from source evidence. The likely remaining causes are an asset HTTP/decode failure, but the current code provides no observable evidence. | Check status explicitly, log `console.warn` with URL/status or decode error, and retain fallback per layer. |
| `js/main.js:15` | major | `onGenerated(config.id, entry.id)` is called per failed layer, but its callback writes `"generated"` to `.channel-status`, which is the whole channel card. One failed layer therefore makes the entire Coffee Shop or Fireplace card appear generated. | Store generated/failed status by `channelId:layerId` and show it only beside that layer in the detail panel. |
| `js/config/soundscapes.js:4,7,10` | minor | Sound definitions have no calibration metadata (`gainDb`, `pan`) and the engine has no trim, drift, bus, compressor, limiter, high-pass, perceptual gain, or random loop offset. | Add metadata in the config and implement the requested layered mix bus in the audio engine. |
| `js/audio/layer.js:4-6` | major | Every source starts at buffer time zero and layer gain is assigned directly; no randomized start offset, perceptual `value^2` mapping, trim, drift, or smooth start is applied. | Add trim/drift/pan nodes, calibrated perceptual gain, random offsets, and 1.2-second starts. |
| `js/audio/engine.js:5` | blocker | The graph is only layer gain → channel gain → master → destination. It has no dedicated mix bus, 40 Hz high-pass, glue compressor, master mute/fade bus, or limiter. `pause()` waits 320 ms before suspending but does not cancel an in-flight pause/resume race. | Build a single bus graph, serialize lifecycle transitions, and suspend only after the fade. |
| `js/audio/fallback.js:3-8` | major | Fallback is a single generic noise buffer and does not reflect the configured layer; it has no layer-specific procedural character or event handling. | Keep it as a quiet per-layer safety net and expose its status without blocking playback. |
| `js/main.js:15,23` | major | The loading element is shown during progress but `render()` only hides it when the engine is absent or not playing. After 100% it remains visible while playing. | Fade it out after completion and show one short inline notice only if failures occurred. |
| `js/main.js:15` | major | The debug surface does not exist. There is no per-layer duration/final-dB report or `AnalyserNode` peak meter. | Add a query-string-gated debug overlay and live analyser meter. |
| `js/ui/theme.js:3` | major | Mood RGB values are written directly to `--bg`, `--surface`, and `--accent`, so a warm channel can turn the page muddy brown. Text tokens are not independently fixed or contrast-checked. | Separate fixed Light/Dark text tokens from a capped pastel/deep mood tint and add contrast enforcement. |
| `css/themes.css:1-4` | major | The theme file has no `--surface-2`, `--text`, `--text-muted`, `--track`, or `--accent-fill` base-theme token system; mood accent is reused for text. | Define complete base tokens and keep text independent from mood. |
| `css/base.css:5` | major | Slider fill uses `--accent` against `--line`; theme/mood changes can make the fill and track visually merge. The shared slider rule does not cover all readouts. | Use a shared, contrast-checked fill/track component and explicit percentage outputs for every slider. |
| `index.html:26,36` | major | The master slider has a percentage output, but the detail channel/layer slider UI is dependent on generated markup and lacks a shared styled/readout implementation. | Make panel sliders use the same component and keep readouts synchronized. |
| `js/ui/detail-panel.js:2` | major | Detail panel controls are rebuilt on every open and focus is only placed on close/open buttons. There is no focus trap, and Escape is handled by a global listener that remains permanently attached. | Add robust dialog focus behavior, Escape close, and focus restoration without accumulating listeners. |
| `js/ui/controls.js:4-17` | major | Playback state is local to `bindControls`; `main.js` separately infers state from `AudioContext.state`. This can desynchronize UI after suspend/resume, and a failed first start leaves the context partially initialized. | Centralize lifecycle state in the engine and cleanly tear down failed initialization. |
| `js/state/store.js:6` | minor | `structuredClone` is unavailable in some older Safari versions and saved numeric values are not validated or clamped. A malformed but parseable object can produce invalid slider state. | Use a compatibility-safe clone/default merge and validate stored ranges and enum values. |
| `js/ui/cards.js:1-2` | minor | Card labels/status text are hard-coded by display name, and cards are click targets containing sliders. Keyboard behavior is present but dialog accessibility and generated per-layer state are incomplete. | Render status and summaries from configuration/state while preserving slider interaction and focus behavior. |
| `js/main.js:24` | minor | A `setInterval` polls generated badges indefinitely even though generated state is event-driven; it is unnecessary work and can outlive the relevant UI state. | Replace polling with direct status updates. |
| `js/ui/controls.js:14` | minor | Keyboard listener is installed once but there is no explicit lifecycle cleanup; shortcuts are ignored while any button/input is focused, which is acceptable but should be documented and tested. | Keep one delegated listener and ensure it cannot trigger duplicate playback operations. |
| `css/components.css:6,11` | major | The detail panel uses a mood-tinted `var(--surface)` and a dark scrim; combined with darkened mood backgrounds this explains the low-contrast panel/header state. | Use a solid base-theme surface and neutral scrim. |
| `README.md` | minor | README does not document debug mode, gain/pan tuning, layered architecture, or the requested full feature set. | Update documentation after implementation. |

## Browser/network evidence

The source-level asset comparison proves all ten configured URLs are correctly spelled and cased. The current loader does not expose fetch status or decoder errors, so it cannot distinguish a 404, a server MIME/response problem, or an MP3 decode failure. This is itself a defect and will be fixed before drawing a stronger runtime conclusion. The source also confirms the generated label is currently channel-wide, independently explaining the observed whole-card labels.
