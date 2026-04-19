# Memory

A poe-code–maintained persistent memory directory that accumulates project knowledge across agent sessions, based on Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## 1. Problem

Every coding agent poe-code wraps — Claude Code, Codex, OpenCode, Kimi, Goose, plus the loop harnesses `superintendent`, `experiment-loop`, and `ralph` — starts each session with zero durable project knowledge beyond what `CLAUDE.md` / `AGENTS.md` and the codebase itself provide. Everything learned during a session (the invariant that broke the last migration, the subtle reason a config knob exists, the right mental model for how two packages interact) is discarded when the session ends. The next session re-derives it, badly, or misses it entirely.

`CLAUDE.md`-style files partially address this, but they are:

- Hand-curated: the user must remember to distill and write them.
- Monolithic: one file per repo, no structure, no cross-links, no decay.
- Not updated by the agent: agents read them but almost never write to them, because there is no convention for doing so safely.

Karpathy's pattern reframes this: the agent *incrementally builds and maintains* a structured set of markdown pages as a side effect of doing real work. Ingest new sources, update affected pages, lint for contradictions. The human curates sources and direction; the LLM does the bookkeeping.

**Why solve this in poe-code specifically.** poe-code sits in front of every supported agent and already owns the `.poe-code/` convention at the project level (`<repo>/.poe-code/`), hosting `config.json`, `experiments/`, `pipeline/`, `ralph/`, `superintendent/`. Memory becomes a sibling directory — `<repo>/.poe-code/memory/` — a single agent-neutral place where project knowledge accumulates regardless of which coding agent the user runs. v1 ships the storage format, the CLI, and the ingest/lint commands; auto-integration with wrapped sessions is a follow-up once the format has settled in real use.

**Evidence this is worth solving now.**

- Long-running loops already re-discover the same facts across iterations (visible in transcripts — same greps, same file reads on iteration N+1 as on N).
- Users manually paste "remember X for next time" into `CLAUDE.md`; a crude version of what this feature automates.
- Karpathy's post is recent, public, and concrete enough to anchor a design without original research.
- The `.poe-code/` directory already exists and is already used for persistent state — adding `memory/` is additive, not a new convention.

**Explicitly out of scope for v1.**

- **Auto-injection into wrapped coding agent sessions.** poe-code does *not* auto-inject memory into `poe-code wrap claude`/`codex`/… sessions, does not modify the agent's context, and does not start a hidden daemon. Memory is CLI + on-disk + a package API. If a user wants an agent to see memory inside a wrapped session, they either paste the result of a CLI command or register the memory MCP server (see §3.9) in their own `.mcp.json`. The *automatic* context-injection story still belongs to the spawn-hooks plugin model sketched in [docs/plans/spawn-hooks.md](spawn-hooks.md) — a memory plugin would observe `PreSpawn` / `PostEvent` and inject/update memory around runs. That's a v2 workstream.
- Not a general-purpose personal knowledge base. Memory is bounded to the active repo.
- Not RAG-style semantic retrieval. Memory is plain markdown, read in full or by path, same as `CLAUDE.md`. No embeddings, no vector index; `search` remains ripgrep.
- Not a graph database. No Leiden clustering, god-node computation, or community detection. At dozens-of-pages scale `INDEX.md` is sufficient.
- Not multimodal. Memory stays markdown-only — images, video, PDFs are out.
- Not a replacement for `CLAUDE.md` / `AGENTS.md`. Memory sits alongside them.
- Not multi-user / team-shared with conflict resolution. v1 assumes one user, one repo, one memory directory; if it gets committed, it gets committed like any other doc.
- No UI beyond CLI. No web viewer, no VSCode panel.

**Inspired by [safishamsi/graphify](https://github.com/safishamsi/graphify).** Five of graphify's shipped patterns translate cleanly onto memory and are folded into this plan as first-class concerns rather than follow-ups:

1. **Confidence tagging** on every non-trivial claim (`extracted` / `inferred` / `ambiguous` + confidence score) — graphify's `EXTRACTED` / `INFERRED` / `AMBIGUOUS` edge labels applied to prose.
2. **Content-hash ingest cache** so re-ingesting unchanged sources is a no-op — graphify's `cache/` SHA256 strategy.
3. **Token-reduction benchmark** reported by `status` and `ingest` — graphify's "71.5× fewer tokens per query" made measurable per repo.
4. **MCP server** (`poe-code memory serve --mcp`) exposing read/write tools — graphify's `python -m graphify.serve` pattern, closing the integration gap without waiting for spawn-hooks v2.
5. **Query / explain surface** (`memory query "<question>"`, `memory explain <page>`) — graphify's `query` / `path` / `explain` as a consumer surface beyond `show`/`search`.

Everything else graphify does (Leiden clustering, multimodal ingest, wiki export, PenPax) is out.

**Decisions locked in from initial discussion.**

- Location: `<repo>/.poe-code/memory/`, following the existing `.poe-code/` convention. Project-scoped only — no user-level memory in v1.
- Name: "memory" (not "wiki", not "knowledge base").
- Scope: CLI + on-disk format + ingest/lint commands. Wrapped-agent integration is explicitly out of scope (see above).
- Git tracking: poe-code does **not** add `.poe-code/memory/` to any gitignore. It's a sharable artifact by default; users who want it private add it themselves.

## 2. User-facing shape

Memory has two surfaces:

1. The `poe-code memory` CLI — humans (and future higher-level commands) inspect, edit, ingest, lint.
2. The on-disk layout — users can `cat`, `grep`, `git diff` memory files directly. No custom format, no index DB.

Wrapped coding agent sessions are deliberately *not* a surface in v1 (see out-of-scope note in altitude 1).

### 2.1 On-disk layout

```text
.poe-code/memory/
├── INDEX.md         # table of contents, regenerated by `memory write`/`ingest`
├── LOG.md           # chronological append-only record of what changed and why
└── pages/
    ├── architecture.md
    ├── packages/
    │   ├── superintendent.md
    │   └── experiment-loop.md
    ├── incidents/
    │   └── 2026-04-10-migration-rollback.md
    └── ...
```

Pages are plain markdown with an optional frontmatter block (name, description, last-touched-at). No database, no embeddings, no special syntax beyond standard markdown links. Universal conventions — kebab-case paths, append-only `LOG.md`, `INDEX.md` is regenerated not hand-written — live in the CLI help and the prompts that `ingest` / `lint` send to spawned agents. Project-specific structure is emergent from `INDEX.md`.

### 2.2 CLI

```bash
# Create .poe-code/memory/ with empty INDEX.md and LOG.md. Idempotent.
poe-code memory init

# List every page with a one-line description from frontmatter.
poe-code memory ls

# Print a page to stdout.
poe-code memory show packages/superintendent.md

# Open a page in $EDITOR. Updates INDEX.md + LOG.md on save.
poe-code memory edit packages/superintendent.md

# Write a page non-interactively (content on stdin). Updates INDEX.md + LOG.md.
poe-code memory write packages/superintendent.md --reason "captured checkpoint rules"

# Append to a page (content on stdin). Intended for LOG.md-style pages.
poe-code memory append LOG.md

# Ripgrep over memory.
poe-code memory search "superintendent"

# Run a one-shot ingest: spawn the configured agent, tell it to read <source>
# and update any relevant memory pages. <source> is a file path or URL.
#   --agent <name>    override the configured agent (defaults to memory.ingestAgent
#                     or the top-level configured agent)
#   --reason <text>   string recorded in LOG.md (defaults to "ingest <source>")
#   --timeout-ms <n>  override memory.ingestTimeoutMs
#   --dry-run         compute the prompt and print it; do not spawn
#   --yes             skip the confirmation prompt shown before spawning
#   --force           bypass the ingest cache even on a content hash hit
#   --no-cache-write  spawn normally but do not persist a cache entry
poe-code memory ingest <source>

# Run a lint pass: spawn the configured agent, tell it to look for
# contradictions, stale claims, and orphan pages; report or fix.
# Also runs the confidence-tag audit (stale `extracted` line refs, bad
# `inferred` confidence values, untagged long prose, missing `ambiguous`
# reason) against the current tree — no spawn required for that pass.
#   --fix             let the agent edit memory (default is report-only)
#   --agent <name>    same as ingest
#   --timeout-ms <n>  same as ingest
#   --dry-run         print the prompt; do not spawn
#   --yes             skip confirmation
poe-code memory lint [--fix]

# Print memory size, page count, last write, and token-reduction stats.
#   --no-tokens  skip the token benchmark (faster on large repos)
poe-code memory status

# Ingest cache maintenance.
poe-code memory cache status
poe-code memory cache clear [--older-than <duration>] [--yes]

# Start a stdio MCP server exposing memory as tools (list_pages,
# read_page, search_memory, append_to_page, status). Default is
# read-only; --allow-writes advertises append_to_page.
#   --allow-writes        expose write tools
#   --print-mcp-config    print a .mcp.json snippet and exit
poe-code memory serve --mcp

# Ask a natural-language question answered from memory only.
# Spawns an agent with memory (INDEX.md + selected pages) as its only
# readable context. Returns an answer + page-level citations.
#   --budget <n>  max tokens the prompt may consume (default 4096)
#   --agent <n>   override the configured agent
#   --json        structured output
poe-code memory query "<question>"

# Summarize a single page plus the pages that cite it / it cites.
poe-code memory explain <rel-path>

# Wipe memory. Asks for confirmation unless --yes. Also wipes .cache/.
poe-code memory clear [--yes]
```

Every command accepts `--json` for scripting.

Example output — `poe-code memory ls`:

```text
.poe-code/memory/ (12 pages, 48KB, last write 2h ago)

pages/architecture.md            How the packages wire together
pages/packages/superintendent.md Loop harness: phases, checkpoints, known pitfalls
pages/packages/experiment-loop.md Experiment runner: source of truth for experiment schemas
pages/incidents/2026-04-10-migration-rollback.md  Why we reverted the acp-client migration
...
```

Example output — `poe-code memory ingest docs/new-feature.md`:

```text
Ingesting docs/new-feature.md via claude-code…
  + created pages/features/new-feature.md
  ~ updated pages/architecture.md (added link to new-feature)
  ~ updated INDEX.md
  + appended to LOG.md
Done in 14s. memory=13,020 tokens, sources=92,500 tokens, 7.1× reduction.
```

Re-run without changing the source — cache hit, no spawn:

```text
$ poe-code memory ingest docs/new-feature.md
cache hit (sha256 8a3f…c91, last ingested 2026-04-10T14:22:00Z) — nothing to do.

$ poe-code memory ingest docs/new-feature.md --force
Ingesting docs/new-feature.md via claude-code (forced)…
  + created pages/features/new-feature.md
cache write: .poe-code/memory/.cache/ingest/8a3f…c91.json
Done in 14s.
```

Example output — `poe-code memory status`:

```text
$ poe-code memory status
.poe-code/memory/ (12 pages, 48KB, last write 2h ago)

tokens
  memory pages         12,400
  cited sources        88,100
  reduction            7.1×

7 cited sources no longer exist on disk — run `poe-code memory lint` to flag them.
```

Example output — `poe-code memory query "..."`:

```text
$ poe-code memory query "why does superintendent retry on ENOENT?"
spawning claude-code (budget=1500 tokens, memory-only context)…

The loop retries on ENOENT during the inspect phase because worktree cleanup
can race with the next iteration's snapshot [pages/packages/superintendent.md
§checkpoints]. The retry cap is 3 and is configured in
[pages/incidents/2026-03-migration.md §post-mortem].

sources:
  - pages/packages/superintendent.md (extracted)
  - pages/incidents/2026-03-migration.md (inferred, 0.8)

Done in 6s. Consumed 1,240 tokens.
```

Example output — `poe-code memory serve --mcp --print-mcp-config`:

```json
{
  "mcpServers": {
    "poe-code-memory": {
      "type": "stdio",
      "command": "poe-code",
      "args": ["memory", "serve", "--mcp"]
    }
  }
}
```

### 2.3 Confidence tags inside page bodies

Non-trivial claims inside page bodies are annotated with an HTML comment immediately before the paragraph they qualify. Markdown renders clean; the tag is machine-parseable.

```markdown
# Superintendent

<!-- memory:extracted source=packages/superintendent/src/phases.ts#L42-L58 -->
The loop has four phases: build, inspect, review, checkpoint.

<!-- memory:inferred confidence=0.7 -->
Checkpoint frequency scales with phase duration, not iteration count.

<!-- memory:ambiguous reason="conflicting notes in pages/incidents/2026-03-migration.md" -->
The inspect phase may retry up to 3 times on ENOENT.
```

Three verbs, each with a required key set: `extracted` needs a `source=<path>[#Lstart[-Lend]]`, `inferred` needs a `confidence=<float 0..1>`, `ambiguous` needs a `reason`. Scope of a tag is until the next blank line or next `memory:*` tag.

Frontmatter gains a denormalized `sources:` list regenerated from the inline tags by reconcile:

```markdown
---
name: superintendent
description: Loop harness — phases, checkpoints, known pitfalls
last_touched_at: 2026-04-18T10:22:00Z
sources:
  - packages/superintendent/src/phases.ts
  - pages/incidents/2026-03-migration.md
---
```

`lint` then has teeth:

```text
$ poe-code memory lint
pages/packages/superintendent.md
  L14 inferred claim (confidence 0.7) has no matching extracted anchor — consider verifying
  L22 ambiguous claim — resolve or remove
pages/architecture.md
  L9  extracted claim cites packages/experiment-loop/src/schema.ts#L120, but file now ends at L104 (stale)

3 issues across 2 pages. Run `poe-code memory lint --fix` to spawn the agent.
```

**Resolved before altitude 3.** `poe-code memory ingest` and `lint` spawn the user's configured agent (matches poe-code's "your agent, our routing" philosophy; reproducibility is a v2 concern).

## 3. Implementation details and technical decisions

### 3.1 Package layout

A single new package: [packages/memory/](packages/memory/).

- `packages/memory/` — owns the on-disk format, the page/index/log primitives, the CLI, and the ingest/lint prompts.
- It depends on:
  - [packages/workspace-resolver/](packages/workspace-resolver/) to find the repo root and compute `<repo>/.poe-code/memory/`.
  - [packages/poe-code-config/](packages/poe-code-config/) to read the configured agent for `ingest`/`lint`.
  - [packages/agent-spawn/](packages/agent-spawn/) to spawn the agent for `ingest`/`lint`.
  - [packages/cmdkit/](packages/cmdkit/) for CLI plumbing. Every `memory` subcommand — including `ingest` and `lint` — is a cmdkit-defined command; flags, help text, and arg parsing come from the cmdkit definition. Validators are plain TS functions that throw on bad input (no zod, no cmdkit-schema).
  - A YAML parser already in the repo for frontmatter (whichever package-extends uses).
- Nothing depends on `memory` in v1 except the top-level CLI wiring that registers `poe-code memory …` subcommands.

The top-level CLI package gets a one-line registration of the `memory` command group. No other package is touched.

### 3.2 Config knobs

Added to `.poe-code/config.json` under a new `memory` key. All optional.

```json
{
  "memory": {
    "ingestAgent": "claude-code",
    "ingestTimeoutMs": 300000,
    "maxPageBytes": 32768,

    "confidence": {
      "rejectUntagged": false,
      "minInferredConfidence": 0.3
    },
    "cache": {
      "enabled": true,
      "maxAgeMs": 2592000000
    },
    "mcp": {
      "allowWrites": false
    },
    "query": {
      "defaultBudgetTokens": 4096
    }
  }
}
```

- `memory.ingestAgent` — override which agent is spawned for `ingest`/`lint`. Defaults to the top-level configured agent.
- `memory.ingestTimeoutMs` — how long to wait for an ingest/lint run before killing it. Default 5 minutes.
- `memory.maxPageBytes` — soft warn threshold when a page grows beyond this. Default 32KB.
- `memory.confidence.rejectUntagged` — if true, `lint` errors (non-zero exit) on any page body >200 chars without at least one `memory:*` tag. Defaults false so v1 adoption is not blocked.
- `memory.confidence.minInferredConfidence` — `lint` issues an error below this threshold (default 0.3). Tag authors signalling <0.3 should almost always switch to `ambiguous`.
- `memory.cache.enabled` — if false, `ingest` never reads or writes the cache; equivalent to always passing `--force --no-cache-write`. Defaults true.
- `memory.cache.maxAgeMs` — entries older than this are ignored on read and pruned on `memory cache clear`. Defaults 30 days.
- `memory.mcp.allowWrites` — default value of `--allow-writes` on `memory serve --mcp`. Defaults false.
- `memory.query.defaultBudgetTokens` — default `--budget` for `memory query` / `memory explain`. Defaults 4096.

No env vars in v1. Config-only.

### 3.3 Ingest / lint spawn mechanics

Both commands follow the same pattern: build a prompt, spawn the configured agent in a scoped CWD, wait for exit, reconcile.

1. **Pre-spawn.** Compute absolute paths for `<repo>/.poe-code/memory/` and resolve the source (file contents read off disk; URLs fetched over HTTP, content materialized to a temp file so the agent sees a plain path). Generate a synthetic prompt that includes:
   - The memory root path.
   - The current `INDEX.md` contents.
   - The source contents (for `ingest`) or nothing (for `lint`).
   - The rules: "update pages under `pages/`, use kebab-case, add/refresh frontmatter (`name`, `description`, `last_touched_at`). Do not edit `INDEX.md`. Append a one-liner to `LOG.md` for each change." (`LOG.md` append is optional — the post-spawn reconcile step regenerates both deterministically either way.)
2. **Spawn.** Call `agent-spawn` with CWD = `<repo>`, the generated prompt as the initial user message, and the configured agent's default tools. The agent uses its built-in filesystem tools (Read/Write/Edit) against `.poe-code/memory/`. poe-code does not run an MCP server for this.
3. **Post-spawn reconcile.** Regardless of what the agent wrote into `INDEX.md` / `LOG.md`:
   - Walk `pages/**/*.md`, read frontmatter, regenerate `INDEX.md` from scratch.
   - Compute a diff between the memory tree before and after the spawn (captured as a snapshot pre-spawn).
   - Parse every `memory:*` tag out of each page body and denormalize their `source=` refs onto the page's frontmatter `sources:` list (authoritative over anything the agent wrote into frontmatter).
   - Append one `LOG.md` line per changed file with timestamp, verb (`create|update|delete`), path, and the spawn's exit reason / provided `--reason`.

This makes the agent-side behavior best-effort and the poe-code-side behavior authoritative. If the agent writes a broken `INDEX.md` or forgets to log, we fix it after the fact.

The ingest-prompt template also instructs the agent to emit confidence tags on every non-trivial claim. That instruction is versioned: a constant `INGEST_PROMPT_VERSION` is bumped in-repo whenever the prompt changes, and fed into the cache key (§3.10) so cache entries from an older prompt are not reused.

### 3.4 Frontmatter and INDEX.md

Frontmatter is YAML at the top of each page:

```markdown
---
name: superintendent
description: Loop harness — phases, checkpoints, known pitfalls
last_touched_at: 2026-04-18T10:22:00Z
---

# body…
```

Only `description` is used by `INDEX.md` rendering. `name` is informational (defaults to the file's basename on read). `last_touched_at` is stamped by the reconcile step, not the agent.

`INDEX.md` is a flat, path-sorted bullet list of `pages/**/*.md` with descriptions:

```markdown
# Memory index

- [architecture](pages/architecture.md) — How the packages wire together
- [packages/experiment-loop](pages/packages/experiment-loop.md) — Experiment runner: source of truth for experiment schemas
- [packages/superintendent](pages/packages/superintendent.md) — Loop harness: phases, checkpoints, known pitfalls
- …
```

No hand-authored content survives regeneration. Users who want narrative intros put them in `pages/README.md` (or similar) and link from there.

### 3.5 LOG.md format

Append-only markdown bullet list, newest last (so `tail` shows recent activity):

```markdown
- 2026-04-18T10:22:00Z  **update** `pages/packages/superintendent.md` — captured checkpoint rules
- 2026-04-18T10:24:11Z  **ingest** `docs/new-feature.md` — created `pages/features/new-feature.md`, updated `pages/architecture.md`
- 2026-04-18T11:02:45Z  **lint**  — no issues
```

Grep-friendly, `git diff`-friendly, no parser required to consume. Reconcile-step writes these; the agent's own attempts to append are overwritten on reconcile if malformed (otherwise left alone and supplemented).

### 3.6 Concurrency

A lockfile at `<repo>/.poe-code/memory/.lock` guards all write operations. This matches the existing `docs/plans/*.md.lock` convention in the repo. Lock is held for the duration of a single CLI command. Stale-lock detection: if the lockfile references a pid that is no longer running, steal it.

Read-only commands (`ls`, `show`, `search`, `status`) do not take the lock.

### 3.7 Edge cases and failure modes

- **Memory not initialized.** Every command except `init` errors with a concrete message pointing at `poe-code memory init`. No auto-init.
- **Path traversal.** `memory write`/`append`/`show`/`edit` resolve the target path and reject anything that escapes `<repo>/.poe-code/memory/pages/` (for writes) or the memory root (for reads).
- **Binary or non-markdown files.** Rejected on write. `ls`/`search` skip them with a warning.
- **Oversized page.** If a write produces a page over `maxPageBytes`, reconcile warns but does not fail. Pages this large are a smell (split them), not an error.
- **Agent ingest/lint crashes or times out.** Reconcile still runs — whatever pages were written before the crash remain, `INDEX.md`/`LOG.md` are regenerated to match on-disk state, the CLI exits non-zero.
- **Agent produces malformed YAML frontmatter.** Reconcile's frontmatter reader falls back to (filename as name, empty description). Warning printed. Nothing is destroyed.
- **URL ingest.** Fetch is best-effort with a 30s timeout. 401/403/5xx → skip with a clear error. No retries in v1.
- **Empty memory.** `ls`/`status` print a friendly "no pages yet; run `poe-code memory ingest <source>` or `poe-code memory write <path>`".
- **`.poe-code/memory/` exists but lacks `INDEX.md`/`LOG.md`.** Reconcile regenerates both next write. `status` reports "degraded, run any write command to heal".

### 3.8 Open questions

- Open question: Do we want a `poe-code memory diff` command that shows what changed between the latest ingest/lint and HEAD (reading `LOG.md`)? Useful for reviewing agent-driven edits before committing. Probably yes, but v1 can ship without it.
- Open question: Should `lint` and `ingest` share prompts or keep two distinct ones? Shared keeps the behavior coherent; distinct keeps each prompt focused. Leaning distinct.
- Open question: Ingestable URLs — do we fetch rendered HTML → markdown (via an existing package), or only accept already-markdown URLs? HTML→markdown is work; restricting to markdown is a sharp edge.

## 4. Interfaces and test plan

### 4.1 Types at the package boundary

All exported from `packages/memory/src/types.ts`. Plain TS, no schema library.

```ts
export type MemoryRoot = string; // absolute path to <repo>/.poe-code/memory

export type PageFrontmatter = {
  name?: string;          // defaults to basename on read
  description?: string;   // rendered by INDEX.md
  lastTouchedAt?: string; // ISO-8601; stamped by reconcile
};

export type MemoryPage = {
  relPath: string;        // e.g. "pages/packages/superintendent.md"
  frontmatter: PageFrontmatter;
  body: string;           // markdown body, frontmatter stripped
  bytes: number;
  mtimeMs: number;
};

export type IndexEntry = {
  relPath: string;
  description: string;    // empty string if missing
};

export type LogVerb = "create" | "update" | "delete" | "ingest" | "lint";

export type LogEntry = {
  timestamp: string;      // ISO-8601
  verb: LogVerb;
  relPath?: string;       // absent for "lint" summary entries
  detail: string;         // free-form human-readable
};

export type MemoryDiff = {
  created: string[];
  updated: string[];
  deleted: string[];
};

export type MemorySnapshot = {
  // Keyed by relPath, value is sha256 of body (fast, deterministic, small).
  pages: Record<string, string>;
};

export type SearchHit = {
  relPath: string;
  lineNumber: number;
  line: string;
};

export type IngestSource =
  | { kind: "file"; absPath: string }
  | { kind: "url"; url: string };

export type IngestOptions = {
  source: IngestSource;
  agent?: string;         // overrides memory.ingestAgent
  reason?: string;
  timeoutMs?: number;
  dryRun?: boolean;
};

export type LintOptions = {
  fix?: boolean;
  agent?: string;
  timeoutMs?: number;
  dryRun?: boolean;
};

export type IngestResult = { diff: MemoryDiff; exitCode: number; durationMs: number };
export type LintResult = { diff: MemoryDiff; issues: string[]; exitCode: number; durationMs: number };
```

### 4.2 Public API of `packages/memory/`

Exported from `packages/memory/src/index.ts`. Every function throws on invalid input — validation is plain TS, no zod.

```ts
// Filesystem layout
export function resolveMemoryRoot(cwd: string): MemoryRoot;
export function initMemory(root: MemoryRoot): Promise<void>;

// Read side (no lock)
export function listPages(root: MemoryRoot): Promise<MemoryPage[]>;
export function readPage(root: MemoryRoot, relPath: string): Promise<MemoryPage>;
export function searchMemory(root: MemoryRoot, query: string): Promise<SearchHit[]>;
export function statusOf(root: MemoryRoot): Promise<{
  pageCount: number;
  totalBytes: number;
  lastWriteAt: string | null;
  initialized: boolean;
}>;

// Write side (takes lock, calls reconcile)
export function writePage(
  root: MemoryRoot,
  relPath: string,
  body: string,
  opts: { frontmatter?: PageFrontmatter; reason: string }
): Promise<MemoryDiff>;

export function appendToPage(
  root: MemoryRoot,
  relPath: string,
  content: string,
  opts: { reason: string }
): Promise<MemoryDiff>;

export function clearMemory(root: MemoryRoot): Promise<void>;

// Reconcile primitives (called internally, exported for testing)
export function snapshot(root: MemoryRoot): Promise<MemorySnapshot>;
export function reconcile(
  root: MemoryRoot,
  before: MemorySnapshot,
  verb: LogVerb,
  detail: string
): Promise<MemoryDiff>;

// Agent-spawning commands
export function ingest(root: MemoryRoot, opts: IngestOptions): Promise<IngestResult>;
export function lint(root: MemoryRoot, opts: LintOptions): Promise<LintResult>;
```

`ingest` and `lint` take an optional injected `spawnFn: SpawnFn` in their options (not shown above for brevity — defaulted from `agent-spawn`) so tests can substitute a fake without involving real processes.

### 4.3 CLI layer

One cmdkit command group, `memory`, registered once in the top-level CLI. Every subcommand is a cmdkit `Command` that:

1. Parses flags via cmdkit's definition.
2. Validates args through plain TS guards (e.g. `assertSafeRelPath(input)` throws `MemoryPathError`).
3. Calls exactly one public function from `packages/memory/src/index.ts`.
4. Formats the result for stdout (human or `--json`).

No business logic lives in the CLI layer — it is a thin shell over the package API.

### 4.4 Test strategy

All unit tests use `memfs` for filesystem work (per CLAUDE.md). No tests write real files except snapshot tests.

| Target | Test type | What it proves |
|---|---|---|
| `resolveMemoryRoot` | unit (memfs) | finds `.poe-code/memory` from a nested CWD; errors when not in a repo |
| `initMemory` | unit (memfs) | idempotent; creates `INDEX.md`, `LOG.md`, `pages/` |
| `listPages` | unit (memfs) | sorts by relPath; skips non-markdown; empty frontmatter tolerated |
| `readPage` | unit (memfs) | parses valid frontmatter; falls back on malformed YAML with a warning; rejects path traversal |
| `writePage` | unit (memfs) | writes body, regenerates `INDEX.md`, appends a single `LOG.md` line, stamps `lastTouchedAt` in frontmatter |
| `appendToPage` | unit (memfs) | preserves existing frontmatter; only body grows; LOG.md line uses `update` verb |
| `clearMemory` | unit (memfs) | wipes `pages/` + regenerates empty `INDEX.md` / `LOG.md` |
| `snapshot` + `reconcile` | unit (memfs) | diff = (created, updated, deleted) computed from before/after hashes; `INDEX.md` matches frontmatter on disk; `LOG.md` grows by N entries for N changes |
| Path validation | unit | rejects `..`, absolute paths, paths outside `pages/`, binary file extensions |
| Lock handling | unit (memfs, fake timers) | two concurrent writes serialize; stale lock (dead pid) is stolen |
| Frontmatter parser | unit | 10+ inputs: valid, missing, malformed, extra fields, CRLF |
| `searchMemory` | unit (memfs) | returns ripgrep-shaped hits; handles no matches; handles 0-byte files |
| `ingest` | unit (memfs, injected `spawnFn`) | calls `spawnFn` with expected CWD + prompt; reconcile runs regardless of spawn success/failure; timeout aborts cleanly; `--dry-run` prints prompt and returns without spawning |
| `lint` | unit (memfs, injected `spawnFn`) | `--fix=false` does not mutate memory; `--fix=true` lets spawn edit; issues list is the agent's stdout summary |
| CLI commands | cmdkit smoke tests | each subcommand parses flags, calls the right package function with the right args (mocked package) |
| Screenshot | `npm run screenshot-poe-code` | `memory ls`, `memory status`, `memory ingest <file> --dry-run` look right in the design system |

No LLM is called in unit tests. `ingest`/`lint` tests inject a fake `spawnFn` that emits canned events and touches specified files — this is the only integration point, and the pattern matches how `agent-spawn` is already tested elsewhere.

Manual QA (markdown checklist — per CLAUDE.md, QA is a doc, not a script) lives at `packages/memory/QA.md`:

- `poe-code memory init` in a repo without `.poe-code/` creates `.poe-code/memory/{INDEX.md,LOG.md,pages/}`.
- `poe-code memory write packages/foo.md --reason hello` appends a line to `LOG.md` and adds an entry to `INDEX.md`.
- `poe-code memory ingest <a local markdown file> --dry-run` prints a prompt containing both the source and the current `INDEX.md`, does not spawn.
- `poe-code memory ingest <a local markdown file>` actually spawns the configured agent; after exit, `INDEX.md` and `LOG.md` reflect whatever pages changed.
- `poe-code memory lint` (no `--fix`) prints issues and leaves memory untouched.
- `poe-code memory clear --yes` wipes memory to the empty state.
- Running two concurrent `memory write` commands: second waits, no corruption.

### 4.5 Rollout and migration

- **No migration.** `.poe-code/memory/` is a new directory. Existing `.poe-code/` entries are untouched.
- **Opt-in and inert.** Nothing happens until the user runs `poe-code memory init`. Even then, no behavior changes for `poe-code wrap` / loops / existing commands. Because memory is never triggered implicitly, it can ship directly to `main` — no beta gate, no rollout sequencing.
- **Package README.** `packages/memory/README.md` documents the CLI, the config knobs (`memory.ingestAgent`, `memory.ingestTimeoutMs`, `memory.maxPageBytes`), and the on-disk layout. Per CLAUDE.md, root README is not modified.
- **Telemetry / observability.** None in v1. If users hit issues, `LOG.md` is the audit trail.
- **Forward path to v2.** When spawn-hooks land, the memory package exports a `SpawnPlugin` that observes `PreSpawn` (inject `INDEX.md`) and `PostEvent` (watch for agent file writes under `.poe-code/memory/` and trigger a reconcile). No existing API in `packages/memory/` needs to change for that to land.

## 5. Code plan

### 5.1 New files

All under `packages/memory/` unless noted.

| File | Purpose |
|---|---|
| `package.json` | Name `@poe-code/memory`, deps on `workspace-resolver`, `poe-code-config`, `agent-spawn`, `cmdkit`, `yaml` (if not already resident) |
| `tsconfig.json` | Standard package tsconfig matching other packages |
| `README.md` | CLI reference, config knobs, on-disk layout |
| `QA.md` | Manual checklist from §4.4 |
| `src/index.ts` | Barrel — re-exports types + public API from §4.2 |
| `src/types.ts` | All types from §4.1 |
| `src/paths.ts` | `resolveMemoryRoot`, `assertSafeRelPath`, path constants |
| `src/frontmatter.ts` | `parseFrontmatter(raw): { frontmatter, body }`, `serializeFrontmatter(fm, body): string` |
| `src/pages.ts` | `listPages`, `readPage` (no lock) |
| `src/write.ts` | `writePage`, `appendToPage`, `clearMemory` (take lock, call reconcile) |
| `src/reconcile.ts` | `snapshot`, `reconcile`, `renderIndex`, `appendLogEntries` |
| `src/search.ts` | `searchMemory` (ripgrep shell-out, same pattern other packages use) |
| `src/status.ts` | `statusOf` |
| `src/lock.ts` | `withLock(root, fn)`, stale-pid detection |
| `src/init.ts` | `initMemory` |
| `src/ingest.ts` | `ingest` — builds prompt, snapshots, calls `spawnFn`, reconciles |
| `src/lint.ts` | `lint` — same pattern as ingest, different prompt |
| `src/prompts/ingest.ts` | The ingest prompt string, with placeholders |
| `src/prompts/lint.ts` | The lint prompt string |
| `src/cli/index.ts` | cmdkit `memory` command group; imports and registers subcommands |
| `src/cli/init.cli.ts` | `poe-code memory init` |
| `src/cli/ls.cli.ts` | `poe-code memory ls` |
| `src/cli/show.cli.ts` | `poe-code memory show <path>` |
| `src/cli/edit.cli.ts` | `poe-code memory edit <path>` (shells out to `$EDITOR`, then writes) |
| `src/cli/write.cli.ts` | `poe-code memory write <path>` (reads stdin) |
| `src/cli/append.cli.ts` | `poe-code memory append <path>` (reads stdin) |
| `src/cli/search.cli.ts` | `poe-code memory search <query>` |
| `src/cli/ingest.cli.ts` | `poe-code memory ingest <source>` with `--agent --reason --timeout-ms --dry-run --yes` |
| `src/cli/lint.cli.ts` | `poe-code memory lint` with `--fix --agent --timeout-ms --dry-run --yes` |
| `src/cli/status.cli.ts` | `poe-code memory status` |
| `src/cli/clear.cli.ts` | `poe-code memory clear --yes` |
| `src/*.test.ts` | One colocated test per module per the test table in §4.4 |

### 5.2 Files changed

| File | Change |
|---|---|
| `src/cli/index.ts` (or wherever top-level `poe-code` commands are registered) | Register the `memory` command group from `@poe-code/memory/cli` |
| `packages/poe-code-config/src/types.ts` | Add optional `memory?: { ingestAgent?: string; ingestTimeoutMs?: number; maxPageBytes?: number }` to the config type |
| Root `package.json` / workspace config | Include `packages/memory` in the workspace glob (likely already a wildcard) |

Nothing else is modified. No changes to `agent-spawn`, `superintendent`, `experiment-loop`, `ralph`, or any wrapped-agent wiring — per out-of-scope in §1.

### 5.3 Key function signatures

Already given in §4.2. Two worth calling out at the internal layer:

```ts
// src/reconcile.ts
export async function reconcile(
  root: MemoryRoot,
  before: MemorySnapshot,
  verb: LogVerb,
  detail: string
): Promise<MemoryDiff> {
  // 1. walk pages/**/*.md → new snapshot
  // 2. diff before vs. after (by sha256 of body)
  // 3. for each changed page, stamp `lastTouchedAt` in frontmatter
  // 4. regenerate INDEX.md from current frontmatter
  // 5. append one LOG.md entry per changed path
}

// src/ingest.ts
export async function ingest(
  root: MemoryRoot,
  opts: IngestOptions & { spawnFn?: SpawnFn }
): Promise<IngestResult> {
  const source = await materializeSource(opts.source); // url → temp file
  const prompt = buildIngestPrompt(root, source);
  if (opts.dryRun) { console.log(prompt); return { diff: empty, exitCode: 0, durationMs: 0 }; }
  const before = await snapshot(root);
  const { exitCode, durationMs } = await runWithTimeout(
    (opts.spawnFn ?? defaultSpawnFn)(opts.agent ?? resolveAgent(), prompt),
    opts.timeoutMs ?? configuredTimeout()
  );
  const diff = await withLock(root, () => reconcile(root, before, "ingest", opts.reason ?? `ingest ${source.label}`));
  return { diff, exitCode, durationMs };
}
```

### 5.4 Build order

Sequenced so the branch stays green after each step. Each step is a commit.

1. **Package skeleton.** `package.json`, `tsconfig.json`, empty `src/index.ts`, `src/types.ts` with all types from §4.1. README stub.
2. **Paths + frontmatter.** `src/paths.ts`, `src/frontmatter.ts`, with tests. Both are pure functions — easiest to ship first.
3. **Read side.** `src/pages.ts`, `src/search.ts`, `src/status.ts`, with tests against `memfs`. No locking needed.
4. **Lock.** `src/lock.ts` with tests (fake timers, stale pid).
5. **Init + clear.** `src/init.ts`, `src/clear` (part of `write.ts`), with tests.
6. **Reconcile.** `src/reconcile.ts` (`snapshot`, `reconcile`, `renderIndex`, `appendLogEntries`) with tests. This is the trickiest pure module — get it right before writes.
7. **Write + append.** `src/write.ts` composing lock + reconcile, with tests.
8. **Config wiring.** Extend `poe-code-config` types; `resolveAgent()`, `configuredTimeout()` readers.
9. **CLI — read commands.** `ls`, `show`, `search`, `status`, `init`, `clear`. Register command group. Run `npm run dev -- memory ls` as a spot check.
10. **CLI — write commands.** `write`, `append`, `edit`. Spot-test each.
11. **Ingest / lint.** `src/ingest.ts`, `src/lint.ts`, prompts, CLI wrappers. Tests use injected `spawnFn`. Manual QA runs real spawns against a test repo.
12. **README + QA.md.** Finalize docs.
13. **Screenshot pass.** `npm run screenshot-poe-code -- memory ls` and friends; verify design-system output.

Each step leaves the tree compilable and the test suite green.

- Open question: Does `memory edit` re-enter through `writePage` on save, or does it trust `$EDITOR` and call `reconcile` directly? Re-entry is cleaner (one write path) but costs a read-serialize-write roundtrip.
- Open question: Is `yaml` already in the dependency tree, or do we need to add it? A grep before step 1 resolves this.
