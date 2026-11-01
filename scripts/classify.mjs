// Pure classification helpers: path tiers, generated files, areas, title types, keyword modifiers, stamp detection.
import { TIERS, GENERATED, TITLE_TYPE_W, KW_HIGH, KW_LOW, REVIEW_KW_HIGH, REVIEW_KW_LOW, STAMP_MIN_CHARS, BOT_LOGINS } from './config.mjs';

export const isGenerated = (path) => GENERATED.test(path);
export const tierOf = (path) => TIERS.find(t => t.re.test(path));
export function areaOf(path) {
  const m = /^(products\/[^/]+|rust\/[^/]+|plugin-server|frontend\/src\/[^/]+|posthog\/[^/]+|ee\/[^/]+|common\/[^/]+|packages\/[^/]+|[^/]+)/.exec(path);
  return m ? m[1] : 'other';
}
export function titleType(title = '') {
  const m = /^(revert)|^(\w+)(?:\([^)]*\))?!?:/i.exec(title.trim());
  if (m?.[1]) return 'revert';
  return m?.[2]?.toLowerCase() ?? 'untyped';
}
export const titleTypeWeight = (t) => TITLE_TYPE_W[t] ?? 1.0;
const count = (re, s) => { re.lastIndex = 0; return (s.match(re) || []).length; };
export function keywordMultiplier(text = '') {
  const hi = Math.min(count(KW_HIGH, text), 3), lo = Math.min(count(KW_LOW, text), 3);
  return { mult: Math.min(1.5, Math.max(0.6, 1 + 0.15 * hi - 0.1 * lo)), hi, lo };
}
export const isBot = (login) => !login || /\[bot\]$/.test(login) || BOT_LOGINS.has(login);
export function isStamp(review) {
  if (isBot(review.author)) return true;
  const body = (review.body || '').trim();
  return review.state !== 'CHANGES_REQUESTED' && review.inline === 0 && body.length < STAMP_MIN_CHARS;
}
export function reviewSubstance(review) {
  const body = review.body || '';
  const hi = Math.min(count(REVIEW_KW_HIGH, body), 3), lo = Math.min(count(REVIEW_KW_LOW, body), 2);
  const s = 1 + 0.5 * Math.min(review.inline, 6) + (body.length > 200 ? 0.5 : 0) + (review.state === 'CHANGES_REQUESTED' ? 1 : 0) + 0.3 * hi - 0.2 * lo;
  return Math.max(0.5, s);
}
