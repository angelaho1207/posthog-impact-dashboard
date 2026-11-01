// Two-pass GraphQL fetch with disk checkpoints. Pass 1: cheap metadata for every merged PR in window.
// Pass 2: reviews/files/body for human PRs, in importance order, so partial data is still the important part.
import fs from 'node:fs';
import { REPO, START, END, BOT_LOGINS, EXCLUDED_LABELS, PREFIX_PRIORITY } from './config.mjs';

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('GITHUB_TOKEN missing');
const SHARD = +(process.argv[3] || 0), SHARDS = +(process.argv[4] || 1);
const P1 = 'data/prs_meta.jsonl', P2 = SHARDS > 1 ? `data/prs_detail.${SHARD}.jsonl` : 'data/prs_detail.jsonl', LOG = 'data/fetch.log';
const log = (m) => { const s = `${new Date().toISOString()} ${m}`; console.log(s); fs.appendFileSync(LOG, s + '\n'); };

async function gql(query, variables, attempt = 0) {
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = null; }
  if (!r.ok || !j || (j.errors && !j.data)) {
    if (attempt < 6) { const wait = 5000 * 2 ** attempt; log(`retry ${attempt} status=${r.status} ${txt.slice(0, 200)}`); await new Promise(s => setTimeout(s, wait)); return gql(query, variables, attempt + 1); }
    throw new Error(`gql failed: ${r.status} ${txt.slice(0, 500)}`);
  }
  const rl = j.data.rateLimit;
  if (rl && rl.remaining < 100) { const ms = new Date(rl.resetAt) - Date.now() + 2000; log(`rate limit low (${rl.remaining}); sleeping ${Math.round(ms / 1000)}s`); await new Promise(s => setTimeout(s, Math.max(ms, 0))); }
  return j.data;
}

const Q1 = `query($q:String!,$after:String){ rateLimit{cost remaining resetAt}
 search(query:$q,type:ISSUE,first:100,after:$after){ issueCount pageInfo{hasNextPage endCursor}
  nodes{ ... on PullRequest { id number title createdAt mergedAt additions deletions changedFiles authorAssociation
   author{ login __typename } labels(first:10){nodes{name}} } } } }`;

async function pass1() {
  const done = new Set(fs.existsSync(P1) ? fs.readFileSync(P1, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).number) : []);
  const doneDays = new Set(fs.existsSync('data/days_done.txt') ? fs.readFileSync('data/days_done.txt', 'utf8').split('\n').filter(Boolean) : []);
  // Newest day first: the most recent data is the most important if time runs out.
  for (let d = new Date(END); d >= START; d = new Date(d.getTime() - 86400e3)) {
    const day = d.toISOString().slice(0, 10);
    if (doneDays.has(day)) continue;
    await fetchRange(`${day}T00:00:00Z`, `${day}T23:59:59Z`, done);
    fs.appendFileSync('data/days_done.txt', day + '\n');
  }
  log('pass1 complete');
}
async function fetchRange(from, to, done) {
  const q = `repo:${REPO.owner}/${REPO.name} is:pr is:merged merged:${from}..${to}`;
  let after = null, n = 0;
  while (true) {
    const d = await gql(Q1, { q, after });
    if (d.search.issueCount > 1000 && !after) { // split range in half; search caps at 1000 results
      const a = new Date(from).getTime(), b = new Date(to).getTime(), mid = new Date((a + b) / 2);
      await fetchRange(from, mid.toISOString(), done); await fetchRange(new Date(mid.getTime() + 1000).toISOString(), to, done); return;
    }
    const rows = d.search.nodes.filter(p => p && p.number && !done.has(p.number));
    fs.appendFileSync(P1, rows.map(p => JSON.stringify({ ...p, author: p.author?.login ?? null, authorType: p.author?.__typename ?? null, labels: p.labels.nodes.map(l => l.name) })).join('\n') + (rows.length ? '\n' : ''));
    rows.forEach(p => done.add(p.number)); n += rows.length;
    if (!d.search.pageInfo.hasNextPage) break; after = d.search.pageInfo.endCursor;
  }
  log(`range ${from.slice(0, 10)} ${n} PRs (cost ok)`);
}

const Q2 = `query($ids:[ID!]!){ rateLimit{cost remaining resetAt}
 nodes(ids:$ids){ ... on PullRequest { id number bodyText
  reviews(first:25){nodes{ author{login} state body submittedAt comments{totalCount} }}
  files(first:60){totalCount nodes{path additions deletions}}
  commits(last:1){nodes{commit{committedDate}}}
  comments(first:30){nodes{author{login} bodyText createdAt}} } } }`;

function isHuman(p) { return p.authorType === 'User' && !BOT_LOGINS.has(p.author) && !p.labels.some(l => EXCLUDED_LABELS.has(l)); }
function priority(p) { const m = /^(\w+)[(:!]/.exec(p.title || ''); return PREFIX_PRIORITY[m?.[1]?.toLowerCase()] ?? 2; }

async function pass2() {
  const meta = fs.readFileSync(P1, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const done = new Set(fs.existsSync(P2) ? fs.readFileSync(P2, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).number) : []);
  const todo = meta.filter(isHuman).filter(p => !done.has(p.number)).sort((a, b) => priority(a) - priority(b) || (b.mergedAt < a.mergedAt ? -1 : 1)).filter((_, i) => i % SHARDS === SHARD);
  log(`pass2: ${todo.length} human PRs to detail (of ${meta.length})`);
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const d = await gql(Q2, { ids: batch.map(p => p.id) });
    const rows = d.nodes.filter(Boolean).map(p => ({ number: p.number, body: (p.bodyText || '').slice(0, 4000),
      reviews: p.reviews.nodes.map(r => ({ author: r.author?.login ?? null, state: r.state, body: r.body, at: r.submittedAt, inline: r.comments.totalCount })),
      files: p.files.nodes, fileCount: p.files.totalCount, lastCommitAt: p.commits.nodes[0]?.commit.committedDate ?? null,
      comments: p.comments.nodes.map(c => ({ author: c.author?.login ?? null, body: (c.bodyText || '').slice(0, 1000), at: c.createdAt })) }));
    fs.appendFileSync(P2, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    if ((i / 50) % 10 === 0) log(`pass2 ${i + batch.length}/${todo.length} remaining=${d.rateLimit.remaining}`);
  }
  log('pass2 complete');
}

const mode = process.argv[2] || 'all';
if (mode === 'pass1' || mode === 'all') await pass1();
if (mode === 'pass2' || mode === 'all') await pass2();
