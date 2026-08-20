import { readTextOrNull } from './content.js';

// Combined token prefix regex — single pass instead of 5 separate patterns
const TOKEN_PREFIX_RE = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{35}|sk-[A-Za-z0-9]{24,})\b/g;
const KEY_BLOCK_RE = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g;
const ASSIGNMENT_RE = /\b[A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\b\s*=\s*[^\s'\"]+/gi;

export const SECRET_VALUE_PATTERNS = [
  KEY_BLOCK_RE,
  TOKEN_PREFIX_RE,
  ASSIGNMENT_RE
];

// Pre-filter regex: only trigger on high-confidence secret indicators.
// Deliberately excludes generic 'key' (too many false positives in source code).
const QUICK_SECRET_CHECK = /\b(?:token|secret|password|api_key|gh[pousr]_|hf_|AKIA|AIza|sk-|BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)/i;

export function looksHighEntropy(value) {
  const compact = String(value).replace(/[^A-Za-z0-9+/=_-]/g, '');
  if (compact.length < 32) return false;
  const unique = new Set(compact).size;
  return unique >= 18 && /[A-Z]/.test(compact) && /[a-z]/.test(compact) && /\d/.test(compact);
}

export function redactSecrets(text) {
  let redacted = String(text ?? '');
  let redactionCount = 0;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      redactionCount += 1;
      return '[REDACTED]';
    });
  }

  redacted = redacted.replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, (match) => {
    if (!looksHighEntropy(match)) return match;
    redactionCount += 1;
    return '[REDACTED]';
  });

  return { text: redacted, redactionCount };
}

/** fastRedactSecrets — skips heavy regex work when nothing suspicious is present */
export function fastRedactSecrets(text) {
  const str = String(text ?? '');
  // Fast-path: no suspicious keywords → skip all pattern matching
  if (!QUICK_SECRET_CHECK.test(str)) {
    return { text: str, redactionCount: 0 };
  }
  return redactSecrets(str);
}
