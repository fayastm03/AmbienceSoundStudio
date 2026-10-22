// Shared by the browser and the server. No browser-only code.
const normalize = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// High recall on purpose: a gentle message shown by mistake is better than a missed cry for help.
const PATTERNS = [
  /\b(kill|killing|hurt|hurting|harm|harming|cut|cutting)\s+(my\s?self|myself)\b/,
  /\bsuicid(e|al)\b/,
  /\bend\s+(it\s+all|my\s+life|everything)\b/,
  /\b(want|wanna|wish|going|plan|planning)\s+(to\s+)?(die|be\s+dead|disappear\s+forever)\b/,
  /\bdon'?t\s+(want\s+to|wanna)\s+(live|be\s+here|exist|be\s+alive|wake\s+up)\b/,
  /\b(can'?t|cannot)\s+(go\s+on|do\s+this\s+anymore|take\s+it\s+anymore|keep\s+going)\b/,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on|continue)\b/,
  /\bbetter\s+off\s+without\s+me\b/,
  /\bwish\s+i\s+(was|were)\s+(dead|never\s+born)\b/,
  /\brather\s+be\s+dead\b/,
  /\btake\s+my\s+(own\s+)?life\b/,
  /\bkms\b/,
];

export function isCrisisText(text) {
  const t = normalize(text);
  return t.length > 0 && PATTERNS.some((pattern) => pattern.test(t));
}

// Fixed text, never model output. The link is built separately (see the prompt below).
export const CRISIS_MESSAGE =
  "I'm really sorry you're going through this. You don't have to face it alone. " +
  "If you might be in danger, please contact your local emergency number right now, " +
  "or reach out to someone you trust. You can find helplines for your country at";
export const HELPLINE_URL = "https://findahelpline.com";
export const HELPLINE_LABEL = "findahelpline.com";