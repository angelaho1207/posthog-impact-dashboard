// Turns fetched PR data into per-engineer component scores, percentiles, evidence, and context. Writes data/scores.json.
import fs from 'node:fs';
import * as C from './config.mjs';
import { isGenerated, tierOf, areaOf, titleType, titleTypeWeight, keywordMultiplier, isBot, isStamp, reviewSubstance } from './classify.mjs';

const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const meta = readJsonl('data/prs_meta.jsonl');
const detail = new Map(fs.readdirSync('data').filter(f => /^prs_detail.*.jsonl$/.test(f)).flatMap(f => readJsonl('data/' + f)).map(d => [d.number, d]));
const isHumanPR = (p) => p.authorType === 'User' && !isBot(p.author) && !p.labels.some(l => C.EXCLUDED_LABELS.has(l));
const human = meta.filter(isHumanPR);
const url = (n) => `https://github.com/${C.REPO.owner}/${C.REPO.name}/pull/${n}`;
const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

// ---- Per-PR delivery weight ----
const prs = human.map(p => {
  const d = detail.get(p.number);
  const files = d?.files ?? null;
  const realFiles = files ? files.filter(f => !isGenerated(f.path)) : null;
  const lines = realFiles ? realFiles.reduce((s, f) => s + f.additions + f.deletions, 0) : (p.additions + p.deletions) * 0.7;
  const tier = realFiles && realFiles.length ? realFiles.map(f => tierOf(f.path)).reduce((a, b) => (b.w > a.w ? b : a)) : { name: files ? 'generated-only' : 'T3 (no file detail)', w: files ? 0.3 : 1.2 };
  const areas = realFiles ? [...new Set(realFiles.map(f => areaOf(f.path)))] : [];
  const type = titleType(p.title);
  const kw = keywordMultiplier(p.title + ' ' + (d?.body ?? '').slice(0, 1500));
  return { ...p, d, lines, tier, areas, type, kw, mainArea: areas[0] ?? null };
});
const P95 = quantile(prs.map(p => p.lines), 0.95);
for (const p of prs) {
  p.delivery = p.type === 'revert' ? 1.0 : p.tier.w * titleTypeWeight(p.type) * p.kw.mult * Math.log1p(Math.min(p.lines, P95));
  p.reason = p.type === 'revert' ? 'revert: fixed recovery credit' : `${p.tier.name} x${p.tier.w} | ${p.type} x${titleTypeWeight(p.type)} | keywords x${p.kw.mult.toFixed(2)} | log(${Math.round(Math.min(p.lines, P95))} real lines)`;
}
const medianDelivery = quantile(prs.map(p => p.delivery), 0.5);

// ---- Engineer accumulators ----
const eng = new Map();
const E = (login, assoc) => { if (!eng.has(login)) eng.set(login, { login, assoc: null, prs: [], reviews: [], unblocks: [], comments: 0, weekly: Array(13).fill(0) }); const e = eng.get(login); if (assoc && assoc !== 'NONE') e.assoc = assoc; return e; };
const weekIdx = (iso) => Math.min(12, Math.max(0, Math.floor((new Date(iso) - C.START) / (7 * 86400e3))));
for (const p of prs) { const e = E(p.author, p.authorAssociation); e.prs.push(p); e.weekly[weekIdx(p.mergedAt)] += p.delivery; }

// Percentile rank with p95 winsorizing. Returns 0..100 per input.
const pctRank = (vals) => { const cap = quantile(vals, 0.95); const w = vals.map(v => Math.min(v, cap)); const s = [...w].sort((a, b) => a - b); return w.map(v => 100 * s.findIndex(x => x >= v) / Math.max(1, s.length - 1)); };
// Preliminary delivery percentile per author: a slice of the helped engineer's impact propagates into unblock credit.
const authors = [...eng.values()];
const prelim = pctRank(authors.map(a => a.prs.reduce((s, p) => s + p.delivery, 0)));
const prelimByLogin = new Map(authors.map((a, i) => [a.login, prelim[i] / 100]));

// ---- Reviews, unblocking, comments ----
for (const p of prs) {
  if (!p.d) continue;
  const firstSubstantive = new Map();
  for (const r of p.d.reviews) {
    if (!r.author || r.author === p.author || isStamp(r)) continue;
    const substance = reviewSubstance(r);
    const drove = !!(p.d.lastCommitAt && r.at < p.d.lastCommitAt);
    const points = substance * p.tier.w * (drove ? 1.5 : 1);
    E(r.author).reviews.push({ pr: p.number, title: p.title, author: p.author, points, substance, inline: r.inline, state: r.state, drove, area: p.mainArea, tier: p.tier.name });
    if (!firstSubstantive.has(r.author) || r.at < firstSubstantive.get(r.author)) firstSubstantive.set(r.author, r.at);
  }
  for (const [login, at] of firstSubstantive) {
    const hours = (new Date(at) - new Date(p.createdAt)) / 3600e3;
    const speed = C.UNBLOCK_SPEED.find(([h]) => hours <= h)[1];
    const helped = prelimByLogin.get(p.author) ?? 0;
    const points = speed * (1 + C.UNBLOCK_PROPAGATION * helped);
    E(login).unblocks.push({ pr: p.number, title: p.title, author: p.author, hours: Math.round(hours * 10) / 10, speed, helpedPct: Math.round(helped * 100), points });
  }
  for (const c of p.d.comments) if (c.author && c.author !== p.author && !isBot(c.author) && (c.body || '').length >= C.STAMP_MIN_CHARS) E(c.author).comments += 1;
}

// ---- Ownership: area shares over substantive PRs (delivery >= median) ----
const areaTotals = new Map(), areaByEng = new Map();
for (const p of prs) if (p.delivery >= medianDelivery && p.mainArea) {
  areaTotals.set(p.mainArea, (areaTotals.get(p.mainArea) || 0) + 1);
  const m = areaByEng.get(p.author) || new Map(); m.set(p.mainArea, (m.get(p.mainArea) || 0) + 1); areaByEng.set(p.author, m);
}
const topAuthorOfArea = new Map();
for (const [login, m] of areaByEng) for (const [area, n] of m) { const cur = topAuthorOfArea.get(area); if (!cur || n > cur.n) topAuthorOfArea.set(area, { login, n }); }

const engineers = [...eng.values()].map(e => {
  const m = areaByEng.get(e.login) || new Map();
  const areas = [...m].filter(([a]) => (areaTotals.get(a) || 0) >= 10).map(([a, n]) => ({ area: a, prs: n, share: n / areaTotals.get(a), top: topAuthorOfArea.get(a)?.login === e.login })).sort((x, y) => y.share - x.share);
  const depth = areas.find(a => a.prs >= 3)?.share ?? 0;
  const breadth = areas.filter(a => a.prs >= 3).length;
  const expertAreas = areas.filter(a => a.top && e.reviews.filter(r => r.area === a.area).length >= 3).map(a => a.area);
  const deliveryRaw = e.prs.reduce((s, p) => s + p.delivery, 0);
  const sortedPRs = [...e.prs].sort((a, b) => b.delivery - a.delivery);
  const first6 = e.weekly.slice(0, 6).reduce((a, b) => a + b, 0), last6 = e.weekly.slice(7).reduce((a, b) => a + b, 0);
  return {
    login: e.login, assoc: e.assoc, url: `https://github.com/${e.login}`,
    raw: { delivery: deliveryRaw, review: e.reviews.reduce((s, r) => s + r.points, 0), unblocking: e.unblocks.reduce((s, u) => s + u.points, 0) + 0.5 * Math.min(e.comments, 20), depth, breadth, expertAreas: expertAreas.length },
    counts: { prs: e.prs.length, detailedPRs: e.prs.filter(p => p.d).length, reviews: e.reviews.length, unblocks: e.unblocks.length, comments: e.comments, medianPR: +quantile(e.prs.map(p => p.delivery), 0.5).toFixed(1) },
    context: { weeksActive: e.weekly.filter(w => w > 0).length, largestPRShare: deliveryRaw ? sortedPRs[0].delivery / deliveryRaw : 0, trend: first6 ? last6 / first6 : null, weekly: e.weekly.map(w => Math.round(w * 10) / 10) },
    evidence: {
      delivery: sortedPRs.slice(0, 3).map(p => ({ n: p.number, url: url(p.number), title: p.title, points: +p.delivery.toFixed(1), reason: p.reason })),
      review: [...e.reviews].sort((a, b) => b.points - a.points).slice(0, 3).map(r => ({ n: r.pr, url: url(r.pr), title: r.title, points: +r.points.toFixed(1), reason: `${r.inline} inline comments | ${r.state.toLowerCase().replace('_', ' ')} | ${r.tier}${r.drove ? ' | landed before last commit' : ''}` })),
      unblocking: [...e.unblocks].sort((a, b) => b.points - a.points).slice(0, 3).map(u => ({ n: u.pr, url: url(u.pr), title: u.title, points: +u.points.toFixed(2), reason: `first substantive review ${u.hours}h after open (speed x${u.speed}) | helped ${u.author} (delivery pct ${u.helpedPct})` })),
      ownership: areas.slice(0, 4).map(a => ({ title: a.area, reason: `${a.prs} substantive PRs | ${(a.share * 100).toFixed(0)}% of area${a.top ? ' | top author' : ''}${expertAreas.includes(a.area) ? ' | also reviews here' : ''}` })),
    },
  };
}).filter(e => e.counts.prs >= C.MIN_ACTIVITY || e.counts.reviews >= C.MIN_ACTIVITY);

// ---- Percentiles and composite ----
const pct = { delivery: pctRank(engineers.map(e => e.raw.delivery)), review: pctRank(engineers.map(e => e.raw.review)), unblocking: pctRank(engineers.map(e => e.raw.unblocking)) };
const depthP = pctRank(engineers.map(e => e.raw.depth)), breadthP = pctRank(engineers.map(e => e.raw.breadth));
const W = C.WEIGHTS, totW = Object.values(W).reduce((a, b) => a + b, 0);
engineers.forEach((e, i) => {
  e.pct = { delivery: pct.delivery[i], review: pct.review[i], unblocking: pct.unblocking[i], ownership: Math.min(100, Math.max(depthP[i], breadthP[i]) + 5 * e.raw.expertAreas) };
  e.score = Object.keys(W).reduce((s, k) => s + W[k] * e.pct[k], 0) / totW;
});
engineers.sort((a, b) => b.score - a.score);

const out = {
  generatedAt: new Date().toISOString(), window: { start: C.START.toISOString().slice(0, 10), end: C.END.toISOString().slice(0, 10), days: C.WINDOW_DAYS },
  coverage: { mergedPRs: meta.length, humanPRs: human.length, detailedPRs: prs.filter(p => p.d).length, excludedPRs: meta.length - human.length, reviewsCounted: engineers.reduce((s, e) => s + e.counts.reviews, 0), engineersRanked: engineers.length, p95Lines: P95, medianPRWeight: +medianDelivery.toFixed(2) },
  weights: C.WEIGHTS,
  methodology: { tiers: C.TIERS.map(t => ({ name: t.name, w: t.w, re: t.re.source })), titleTypes: C.TITLE_TYPE_W, kwHigh: C.KW_HIGH.source, kwLow: C.KW_LOW.source, reviewKwHigh: C.REVIEW_KW_HIGH.source, reviewKwLow: C.REVIEW_KW_LOW.source, generated: C.GENERATED.source, excludedLabels: [...C.EXCLUDED_LABELS], botLogins: [...C.BOT_LOGINS], stampMinChars: C.STAMP_MIN_CHARS, unblockSpeed: C.UNBLOCK_SPEED.map(([h, f]) => ({ withinHours: h === Infinity ? null : h, factor: f })), unblockPropagation: C.UNBLOCK_PROPAGATION, minActivity: C.MIN_ACTIVITY },
  engineers,
};
fs.writeFileSync('data/scores.json', JSON.stringify(out));
console.log(`ranked ${engineers.length} engineers from ${human.length} human PRs (${out.coverage.detailedPRs} detailed) of ${meta.length}`);
console.log(engineers.slice(0, 8).map(e => `${e.login.padEnd(18)} ${e.score.toFixed(1)}  D${e.pct.delivery.toFixed(0)} R${e.pct.review.toFixed(0)} U${e.pct.unblocking.toFixed(0)} O${e.pct.ownership.toFixed(0)}  prs=${e.counts.prs} rev=${e.counts.reviews}`).join('\n'));
