// Single place for every tunable: window, exclusions, tiers, keywords, weights.
export const REPO = { owner: 'PostHog', name: 'posthog' };
export const WINDOW_DAYS = 90;
export const END = new Date('2026-10-31T23:59:59Z');
export const START = new Date(END.getTime() - WINDOW_DAYS * 86400e3);

// Authors and labels that carry no human authorship credit.
export const BOT_LOGINS = new Set(['PostHog', 'posthog-bot', 'dependabot', 'dependabot-preview', 'github-actions', 'scheduled-actions-posthog', 'stamphog']);
export const EXCLUDED_LABELS = new Set(['self-driving', 'automated', 'dependencies']);

// Title prefix priority for fetch ordering (lower = fetch first).
export const PREFIX_PRIORITY = { fix: 0, perf: 0, feat: 0, refactor: 1 };

// ---- Scoring tunables ----
export const WEIGHTS = { delivery: 35, review: 25, unblocking: 15, ownership: 25 };
export const MIN_ACTIVITY = 3; // ranked engineers need >=3 human PRs or >=3 substantive reviews

export const TIERS = [ // first match wins; weight expresses criticality
  { name: 'T1 core (CODEOWNERS-protected)', w: 3.0, re: /^(posthog\/clickhouse\/migrations|posthog\/hogql\/(?!database\/schema)|\.github\/workflows\/(ci-security|codeql)|\.github\/actions\/semgrep)/ },
  { name: 'T2 backend & data path', w: 2.0, re: /^(posthog\/(api|models|migrations|clickhouse|kafka|temporal|batch_exports|hogql|warehouse|session_recordings)|plugin-server\/src|rust\/|ee\/(billing|api|clickhouse)|products\/[^/]+\/backend)/ },
  { name: 'T3 product & frontend', w: 1.2, re: /^(frontend\/src|products\/|posthog\/|ee\/|common\/|packages\/)/ },
  { name: 'T4 docs, config, tooling', w: 0.5, re: /./ },
];
export const GENERATED = /(pnpm-lock\.yaml|package-lock\.json|Cargo\.lock|uv\.lock|poetry\.lock|__snapshots__\/|\.ambr$|\.snap$|schema\.json$|queries\/schema\.py$|openapi|\.generated\.|\.min\.js$|mypy-baseline\.txt|^dist\/|\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?)$)/i;

export const TITLE_TYPE_W = { fix: 1.3, perf: 1.3, feat: 1.2, refactor: 0.8, chore: 0.5, test: 0.6, docs: 0.3, ci: 0.5, style: 0.3, build: 0.5 };
export const KW_HIGH = /\b(migration|backfill|clickhouse|kafka|ingestion|hogql|schema|race|concurren\w*|deadlock|memory|perf\w*|timeout|retry|idempoten\w*|security|auth\w*|billing|incident|hotfix|rollback)\b/gi;
export const KW_LOW = /\b(bump|typo|rename|move|lint|format\w*|copy|wording|flaky|snapshot|cleanup|dead code|deps)\b/gi;
export const REVIEW_KW_HIGH = /(what happens if|\brace\b|migration|backward|rollback|security|\btest\w*|regression|n\+1|\bindex\b|\?)/gi;
export const REVIEW_KW_LOW = /\b(lgtm|nit|typo|looks good|ship it)\b/gi;
export const STAMP_MIN_CHARS = 80;
export const UNBLOCK_SPEED = [[4, 1.5], [24, 1.2], [72, 1.0], [Infinity, 0.7]]; // hours -> factor
export const UNBLOCK_PROPAGATION = 0.3; // helped engineer's delivery percentile adds up to +30%
