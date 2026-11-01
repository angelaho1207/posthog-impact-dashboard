# Implementation prompt (as executed)

Build a single-page static dashboard that answers "who are the most impactful engineers at PostHog?" over the last
90 days of merged PRs in PostHog/posthog, for a busy engineering leader. Constraints: fits one laptop screen, loads in
under 1 s, every number traceable to linked PRs and an explicit formula, interactive weights for sensitivity analysis.

## Data (scripts/fetch.mjs, GitHub GraphQL, token from `gh auth token`)
- Pass 1: for each day newest-first, `search(is:pr is:merged merged:DAY)` paged at 100; split a range in half if it
  exceeds the 1,000-result cap. Store number, title, author, authorAssociation, timestamps, additions/deletions,
  changedFiles, labels. Checkpoint per day.
- Pass 2: `nodes(ids)` in batches of 50 for human PRs only (drop `[bot]`, org account, labels self-driving/automated/
  dependencies), ordered fix/perf/feat → refactor → other, newest first, so partial data covers the important PRs.
  Store body (4k chars), reviews (author, state, body, submittedAt, inline comment count), files (path, +/-),
  last commit time, issue comments. Shardable (`pass2 <k> <n>`); retry with backoff; sleep on low rate limit.

## Classification (scripts/classify.mjs, all tunables in scripts/config.mjs)
- Path tiers, most critical file wins: T1 ×3 CODEOWNERS-protected (clickhouse migrations, hogql, security CI);
  T2 ×2 api/models/migrations/kafka/temporal/batch_exports/warehouse/session_recordings, plugin-server, rust, ee
  billing/api, products/*/backend; T3 ×1.2 frontend and remaining product code; T4 ×0.5 everything else.
- Generated files excluded from line counts (lockfiles, snapshots, .ambr, schema.json, openapi, minified, images).
- Title type from conventional-commit prefix: fix/perf ×1.3, feat ×1.2, refactor ×0.8, chore/ci/build ×0.5,
  test ×0.6, docs/style ×0.3, revert = fixed 1.0 credit.
- Difficulty keywords on title + body: +15% per high hit (max 3), −10% per low hit (max 3), clamped 0.6–1.5.
- Stamp review: bot author, or zero inline comments and <80 chars unless changes requested.
- Review substance: 1 + 0.5/inline (max 6) + 0.5 long body + 1 changes requested + 0.3/high keyword − 0.2/low.

## Scoring (scripts/score.mjs → data/scores.json)
- Delivery per PR = tier × type × keywords × log1p(min(real lines, p95)). PRs lacking file detail: metadata lines
  ×0.7, tier T3. Engineer delivery = sum.
- Review points = substance × reviewed PR tier × 1.5 if submitted before the PR's last commit.
- Unblocking per PR = speed factor of first substantive review (≤4h 1.5, ≤24h 1.2, ≤72h 1.0, else 0.7)
  × (1 + 0.3 × helped author's preliminary delivery percentile) + 0.5 per substantive comment on others' PRs (max 20).
- Ownership: over substantive PRs (delivery ≥ median), per area (products/x, posthog/x, frontend/src/x, rust/x …)
  with ≥10 PRs. Depth = best area share with ≥3 PRs; breadth = areas with ≥3 PRs. Percentile = max(depth pct,
  breadth pct) + 5 per area where top author and ≥3 reviews given there.
- Rank only engineers with ≥3 PRs or ≥3 substantive reviews. Winsorize each raw component at p95, percentile-rank
  0–100, score = Σ w·pct / Σ w with defaults delivery 35, review 25, unblocking 15, ownership 25.
- Context, never scored: weeks active of 13, largest-PR share, last-6 ÷ first-6 weeks trend, weekly sparkline.
- Evidence: top 3 PRs/reviews/unblocks per component with the multipliers that fired; top 4 owned areas.

## UI (scripts/dashboard.html → scripts/build.mjs → docs/index.html)
- Header: question, window, coverage counts, one-sentence definition of impact.
- Five cards: rank, login, association badge, score /100, stacked bar of weighted components, counts + sparkline +
  trend, one evidence line per component with "why" expanding to the formula trace and two more items.
- Weight sliders re-rank live and report how many of the default top 5 survive. Full sortable table with per-component
  percentiles, PRs, reviews, median PR weight, weeks, top-PR share, trend. Methodology panel with every rule and regex.
- Plain HTML/CSS/JS, no libraries, data embedded as JSON, dark mode via prefers-color-scheme.

## Verification
- scripts/test.mjs asserts title typing, tier matching, generated-file detection, stamp detection, keyword direction.
- Visual check at 1366×768 and narrow widths; console clean; coverage line must match scores.json.
