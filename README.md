# PostHog Engineering Impact Dashboard

Live: https://angelaho1207.github.io/posthog-impact-dashboard/

Answers "who are the most impactful engineers at PostHog?" for the last 90 days of merged PRs in
[PostHog/posthog](https://github.com/PostHog/posthog), for a busy engineering leader, on one laptop screen.

## Definition of impact

Impact = quality-weighted work shipped in critical parts of the system + how much an engineer makes
other engineers' work better and faster. Four components, each a percentile rank across ranked engineers,
blended with adjustable weights (defaults in parentheses):

| Component | What it measures | Why |
|---|---|---|
| Delivery (35) | Per merged PR: criticality tier of the most critical file × title type (fix/perf/feat > refactor > chore/docs) × difficulty keywords × log(real lines, generated files excluded, capped at p95). Summed. | Rewards hard work in risky code, not volume or line count. |
| Review substance (25) | Human, non-stamp reviews: inline comments, long bodies, changes requested, review keywords, × reviewed PR's tier, ×1.5 if the review landed before the PR's last commit. | Measures reviews that changed code, not rubber stamps. |
| Unblocking (15) | Speed of the reviewer's first substantive review per PR (≤4h ×1.5 … >72h ×0.7), scaled up to +30% by the helped engineer's delivery percentile, plus substantive comments on others' PRs. | Fast, useful feedback keeps the team moving; helping a high-impact engineer ship matters more. |
| Ownership & reach (25) | max(depth, breadth): share of an area's substantive PRs, or number of areas with ≥3 substantive PRs; bonus when top author in an area also reviews others there. | Rewards owning a system or meaningfully spanning several, not scattered small edits. |

Consistency (weeks active, largest-PR share) and trend (last 6 weeks ÷ first 6) are shown as context and never scored:
impact accumulates, and penalizing an engineer for one six-week critical project would be wrong.

## Key decisions

- **Structural signals before keywords.** Path tiers (seeded from PostHog's CODEOWNERS) and conventional-commit
  title types are auditable; keywords only modify them.
- **Bots and autonomous agents excluded.** `[bot]` authors, the org account, and PRs labelled `self-driving`,
  `automated`, `dependencies`. Stamp reviews (no inline comments, <80 chars, not changes-requested) are ignored.
- **Agent-assisted human PRs count at full weight** and are judged by the same rules, so agent busywork
  (moves, bumps, chores) scores low and agent-executed critical work scores high.
- **Percentile ranks, winsorized at p95.** Robust to heavy tails and to one giant PR or one hyper-prolific account.
- **Members and contributors ranked together**, with a badge.
- **Every number is traceable.** Each top-5 card shows three linked evidence PRs/reviews per component with the exact
  multipliers that fired; the methodology panel lists every rule, regex, exclusion, and coverage count.
- **Static HTML with embedded JSON** on GitHub Pages: sub-second load, no runtime API calls.

## Pipeline

```
scripts/config.mjs     every tunable: window, weights, tiers, keywords, exclusions
scripts/fetch.mjs      GitHub GraphQL. Pass 1: metadata for all merged PRs (newest day first).
                       Pass 2: files/reviews/comments/body for human PRs, most important first. Checkpointed; shardable.
scripts/classify.mjs   pure helpers: tiers, generated files, areas, title types, keyword and stamp logic
scripts/score.mjs      components, percentiles, evidence, context  ->  data/scores.json
scripts/build.mjs      embeds scores.json into scripts/dashboard.html  ->  docs/index.html
scripts/test.mjs       classifier unit tests
```

```bash
export GITHUB_TOKEN=$(gh auth token)
node scripts/fetch.mjs all            # or: pass1 | pass2 <shard> <shards>
node scripts/test.mjs && node scripts/score.mjs && node scripts/build.mjs
```

## Known limits

Percentiles are relative, not an absolute bar. Reviews capped at first 25 per PR, files at first 60.
PRs without file detail (fetch still in progress at publish time) use metadata line counts ×0.7 and tier T3;
the coverage line on the dashboard states how many PRs have full detail.
