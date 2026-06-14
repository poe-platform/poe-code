---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json
kind: superintendent
version: 1

builder:
  agent: poe-agent:openai/gpt-5.4
  prompt: |
    Build the highest-priority open task from {{plan.path}}. Tests before code.

inspectors:
  code-quality:
    agent: poe-agent:openai/gpt-5.4
    prompt: |
      Review convention + architecture. Flag SOLID/YAGNI/KISS violations, proxy-only functions, over-used constants, and tests that leaked complexity into production code.
  testing:
    agent: poe-agent:openai/gpt-5.4
    prompt: |
      Verify every new module has a colocated `*.test.ts` using memfs (no real FS, no LLM). Run the package test suite and report any failure — no pre-existing excuses.
  poe-agent-improver:
    agent: claude-code
    prompt: |
      Replay the builder with `npm run replay -- {{builder.log_path}}` and study how poe-agent actually executed this round. Propose one *systemic* improvement to the agent (prompting, tool wiring, plugin model, loop control) — never a one-off patch. Keep poe-agent prompting extremely lean; reject anything that bloats the system prompt.
  superintendent-improver:
    agent: claude-code
    prompt: |
      Replay every available phase with `npm run replay -- <path>`: builder=`{{builder.log_path}}`, inspectors=`{{inspector_logs.code-quality}}` / `{{inspector_logs.testing}}` / `{{inspector_logs.poe-agent-improver}}`, superintendent=`{{superintendent.log_path}}`, owner=`{{owner.log_path}}` (superintendent/owner paths are empty on round 1; use the previous round's paths from round 2 onward). Verify MCP came up clean, role handovers carried the right context, and template variables resolved. Flag systemic issues only — never one-off fixes.

superintendent:
  agent: poe-agent:openai/gpt-5.4
  prompt: |
    Review builder + inspector output, update the Task Board in {{plan.path}}, and hand to owner only when every open task is checked and every inspector accepted.

    Commit changes if approved

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## code quality
    {{inspectors.code-quality}}

    ## testing
    {{inspectors.testing}}

    ## poe-agent improver
    {{inspectors.poe-agent-improver}}

    ## superintendent improver
    {{inspectors.superintendent-improver}}

owner:
  agent: claude-code
  prompt: |
    Approve or send back based on {{superintendent.summary}}. Reject if any Task Board item is open, any inspector is red, new code lacks tests, or the two meta inspectors found systemic issues that were not addressed.

max_rounds: 100

status:
  state: in_progress
  round: 38
  review_turn: 0
---

## Task Board

- [x] Memory package, CLI, cache, MCP, query/explain, and tests landed.
- [x] Testing inspector satisfied on package test suite and colocated coverage.
- [x] poe-agent plugin bundle drift patched by adding the missing environment plugin.
- [x] Remove the provider-specific `poe-agent` branch in `packages/superintendent/src/commands/run.ts` by making `poe-agent` a first-class ACP provider through the shared middleware path.
- [x] Delete duplicated poe-agent observability plumbing (`poe-agent-runner.ts` / `poe-agent-transcript.ts`) once replay/logging/usage/session capture flow through shared ACP middleware.
- [x] Address inspector-raised systemic follow-up: enforce dedicated file/search/list tools in poe-agent shell plugin across modes for pure read wrappers.
- [x] Address inspector-raised systemic follow-up: ensure `packages/superintendent/src/runtime/run-builder.ts` always returns a real builder `log_path` for poe-agent runs so replay-based inspectors receive resolved transcript paths.

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
4. **MCP server** (`poe-code memory-mcp`) exposing read/write tools — graphify's `python -m graphify.serve` pattern, closing the integration gap without waiting for spawn-hooks v2.
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

# Install the `poe-code-memory` skill and register the memory-mcp server
# with the configured agent's MCP config (~/.mcp.json or project .mcp.json).
# Idempotent — re-running updates the existing entries in place.
#   --agent <name>    which agent to install for (claude-code, codex, opencode)
#   --scope <s>       `local` (project) or `global` (home). Defaults local.
#   --skill-only      install the skill but do not touch MCP config
#   --mcp-only        register the MCP server but do not install the skill
#   --allow-writes    register the MCP server with `--allow-writes`
#   --dry-run         print what would change; touch nothing
poe-code memory install

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
poe-code memory-mcp

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

Example output — `poe-code memory-mcp --print-mcp-config`:

```json
{
  "mcpServers": {
    "poe-code-memory": {
      "type": "stdio",
      "command": "poe-code",
      "args": ["memory-mcp"]
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
  - [packages/toolcraft/](packages/toolcraft/) for CLI plumbing. Every `memory` subcommand — including `ingest` and `lint` — is a toolcraft-defined command; flags, help text, and arg parsing come from the toolcraft definition. Validators are plain TS functions that throw on bad input (no zod, no toolcraft-schema).
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
- `memory.mcp.allowWrites` — default value of `--allow-writes` on `memory-mcp`. Defaults false.
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
- **Agent ingest/lint crashes or times out.** Reconcile still runs — whatever pages were written before the crash remain, `INDEX.md`/`LOG.md` are regenerated to match on-disk state, the CLI exits non-zero. Cache is not written.
- **Agent produces malformed YAML frontmatter.** Reconcile's frontmatter reader falls back to (filename as name, empty description). Warning printed. Nothing is destroyed.
- **URL ingest.** Fetch is best-effort with a 30s timeout. 401/403/5xx → skip with a clear error. No retries in v1.
- **Empty memory.** `ls`/`status` print a friendly "no pages yet; run `poe-code memory ingest <source>` or `poe-code memory write <path>`".
- **`.poe-code/memory/` exists but lacks `INDEX.md`/`LOG.md`.** Reconcile regenerates both next write. `status` reports "degraded, run any write command to heal".
- **Confidence tag with nonexistent source path.** `lint` reports it as an issue with the resolved path + "file does not exist". Not destructive.
- **Inline `source=` references an out-of-range line.** `lint` reports old vs current EOF; suggests re-verifying.
- **`inferred` confidence outside `(0, 1]`.** Reject on parse. `0` is reserved for "guess" and rejected; the author should have used `ambiguous`.
- **Cache hit but source file is now deleted.** Treated as miss (key re-derives from current state; we can't hash a missing file); cache entry kept for audit.
- **Cache entry references a prompt version or agent id that no longer exists.** Different key by definition → treated as miss.
- **Token counter throws on a weird file.** Count as 0, warn once per run, surface in `missingSources`.
- **MCP client calls `append_to_page` with writes disabled.** Return `McpError.methodNotFound` (matches stdio server convention) — the tool is not advertised in `tools/list`.
- **MCP server started but memory not initialized.** Advertise 0 tools; every call returns a clear error pointing at `memory init`. Don't auto-init.
- **`query` with empty memory.** Return `answer: ""`, exit 0, print "memory is empty; add pages first".
- **`query` budget too small to even fit INDEX.md.** Error: "budget too small; needs at least N tokens".
- **`explain` on a page with no `sources:`.** Still works — summarises the page alone; `inboundPages` may also be empty.

### 3.8 Open questions

- Open question: Do we want a `poe-code memory diff` command that shows what changed between the latest ingest/lint and HEAD (reading `LOG.md`)? Useful for reviewing agent-driven edits before committing. Probably yes, but v1 can ship without it.
- Open question: Should `lint` and `ingest` share prompts or keep two distinct ones? Shared keeps the behavior coherent; distinct keeps each prompt focused. Leaning distinct.
- Open question: Ingestable URLs — do we fetch rendered HTML → markdown (via an existing package), or only accept already-markdown URLs? HTML→markdown is work; restricting to markdown is a sharp edge.
- Open question: HTML-comment tags (`<!-- memory:extracted ... -->`) vs a fenced-code convention (` ```memory:extracted ... ``` `). Comments win on invisibility; fenced wins on multi-line claims. Prototype both, ship one.
- Open question: should cache hits update `last_touched_at` on the pages they "would have" touched? Leaning no — `last_touched_at` should reflect actual writes.
- Open question: should `query` be able to call out to `search_memory` as a tool instead of flattening context upfront? More powerful, harder to bound tokens, matches graphify's MCP approach. Lean no for v1; revisit when spawn-hooks land.
- Open question: does `tokenfill` counting a full source file match what an agent would actually see? It's an upper bound — agents chunk and drop. The ratio is still directionally right. A dedicated `memory bench` command is deferred.

### 3.9 Confidence tagging

**Format.** HTML comment, single line, before the claim it qualifies. Regex-parseable, invisible in rendered markdown, `git diff`-friendly, survives `git blame`.

```text
<!-- memory:<verb> key=value key="quoted value" ... -->
```

Verbs and required keys:

- `extracted` — requires `source=<path>[#Lstart[-Lend]]`; optional `note`.
- `inferred` — requires `confidence=<float 0..1>`; optional `note`, optional `source`.
- `ambiguous` — requires `reason`; no other keys.

Scope of a tag: until the next blank line or next `memory:*` tag, whichever comes first. Parsers treat the intervening paragraph as the claim body. No nesting.

**Why HTML comment, not a sidecar file or richer frontmatter.** Frontmatter only supports page-level metadata; we need claim-level. Sidecar files double the read cost and drift. HTML comments render invisibly, are one-liners, and survive every obvious plumbing (copy/paste, `git blame`, `grep`).

**Writing them.** The ingest/lint prompt templates instruct the agent to emit these tags on every non-trivial claim. The reconcile step parses the final file and (a) denormalizes every `source=` onto frontmatter `sources:`, (b) refuses to promote a write that has zero tagged claims when page body is >200 chars and `memory.confidence.rejectUntagged` is true.

**Lint checks.**

1. Every `extracted` tag resolves: path exists (repo-relative), line range in bounds. Stale → issue.
2. Every `inferred` tag has `confidence` in `(0, 1]` and above `minInferredConfidence`. Otherwise issue.
3. Every `ambiguous` tag has a non-empty `reason`.
4. Page body >200 chars with zero tags → warn (likely raw agent text).
5. Frontmatter `sources:` is a superset of inline-tag sources — never less, never stale. Reconcile keeps this true; lint catches it if someone hand-edits a page and breaks invariant.

`lint --fix` lets the agent repair these; `lint` alone reports and exits non-zero on any issue.

### 3.10 Ingest cache

**Location.** `<repo>/.poe-code/memory/.cache/ingest/<sha>.json`. Inside memory root so `memory clear` also wipes it. Cache dir is created lazily on first write.

**Cache key.**

```ts
const key = sha256(
  sourceBytes +                    // the file/URL content at ingest time
  indexMdBytes +                   // state of INDEX.md when ingest started
  promptTemplateVersion +          // bumped in-repo when prompt changes
  agentId                          // e.g. "claude-code@1.2.3"
);
```

Every component is in the key for a reason:

- `sourceBytes` — the only thing that *should* invalidate on user change.
- `indexMdBytes` — a new page added elsewhere can change how the agent routes this ingest.
- `promptTemplateVersion` — prompt changes shift behavior; stale results after a prompt improvement are worse than re-running.
- `agentId` — swapping agents is a different run.

**Cache value.**

```ts
type IngestCacheEntry = {
  key: string;
  ingestedAt: string;               // ISO-8601
  sourceLabel: string;              // the path or URL passed in
  diff: MemoryDiff;                 // what changed (for audit)
  exitCode: number;
  durationMs: number;
  memoryTokens: number;             // snapshot at ingest time
  sourceTokens: number;
  promptTemplateVersion: string;
  agentId: string;
};
```

**Hit behavior.** On hit: log the hit, skip the spawn, still run reconcile (so `INDEX.md`/`LOG.md` reflect current tree), record a `LOG.md` entry only if there was actually a diff — cache hits with empty diffs skip the LOG line to avoid noise.

**Flags.** `--force` bypasses read-side cache (and writes a fresh entry); `--no-cache-write` does a normal spawn but does not persist. Both are orthogonal to `memory.cache.enabled` (which turns the whole thing off).

**Eviction.** Nothing automatic. `memory cache clear [--older-than <duration>]` is explicit. `--older-than` accepts `30d`, `24h`, `90m`.

### 3.11 Token-reduction benchmark

**Counter.** `packages/tokenfill/` already contains a tokenizer. Expose (or re-use) `countTokens(text: string): number` and call it directly. No new tokenizer dep.

**What counts as "memory tokens".** `countTokens(body)` summed across every page. `INDEX.md` and `LOG.md` are excluded — they're structural, not content.

**What counts as "source tokens".** Union of paths in every page's frontmatter `sources:`. For each unique path, `countTokens(fs.readFile(path))`. Missing paths are counted as 0 and listed separately (`missingSources`).

**Ratio.** `sourceTokens / max(memoryTokens, 1)`. The `max` avoids divide-by-zero on empty memory.

**Where it's reported.** `status` by default (can be skipped with `--no-tokens`); `ingest` and `lint` completion lines include it as `memory=X, sources=Y, ratio=Z×`. `IngestCacheEntry` snapshots the two counts at ingest time for per-run audit.

### 3.12 MCP server

**Package wiring.** Use `packages/tiny-stdio-mcp-server/` — the same server the other stdio MCP tools in this repo use. No new deps.

**Tool surface** (snake_case, matching the recent `superintendent` MCP convention — see commit `60d733af`):

| Tool | Args | Returns | Gate |
|---|---|---|---|
| `list_pages` | `{}` | `{ pages: { rel_path, description }[] }` | always |
| `read_page` | `{ rel_path }` | `{ rel_path, frontmatter, body, bytes }` | always |
| `search_memory` | `{ query, limit? }` | `{ hits: SearchHit[] }` | always |
| `append_to_page` | `{ rel_path, content, reason }` | `{ diff }` | writes |
| `status` | `{}` | `StatusOf & { tokens: TokenStats }` | always |

**Write gating.** `--allow-writes` (or `memory.mcp.allowWrites: true`) flips write tools on. Default off. When disabled, write tools are *not* advertised in `tools/list` — a client that has never seen them won't try to call them.

**Concurrency.** The MCP server takes the same lockfile as `writePage`/`appendToPage` for write tools. Reads don't lock. Two clients appending concurrently serialize via the lock.

**Process lifecycle.** `poe-code memory-mcp` is a foreground process. Ctrl-C releases the lock. Expected wiring is via the user's MCP config (`~/.mcp.json` / project `.mcp.json`), not manual invocation. `--print-mcp-config` prints the JSON snippet and exits (no server started).

### 3.13 Query / explain

Both commands are thin spawn wrappers that build a prompt with memory as the only readable context.

**Context preparation.**

1. Read `INDEX.md`, all pages, and frontmatter.
2. If combined `countTokens(...)` exceeds `--budget` (default 4096), include `INDEX.md` plus top-ranked pages. Ranking is a cheap TF-idf over page names + descriptions matched against the query — no embeddings.
3. Pass the selected pages verbatim in the prompt. The spawned agent is given *no tools* — we want a pure transform question → answer, not a fresh ingest.

**Prompt contract.** The prompt tells the agent: "answer using only the provided memory pages. Cite pages and sections with `[rel_path §section]`. If the memory does not answer the question, say so."

**`explain <page>`.** Special case: context = the named page + every page listed in its frontmatter `sources:` that happens to be another memory page + every page that lists it in its `sources:` (reverse edges). Produces a 1-2 paragraph summary plus a links graph.

**Output format.** Human by default; `--json` returns `QueryResult` from §4.1. Confidence labels on citations come from the cited page's tags — lookup by `section` heading.

**No session state.** Each invocation is a fresh spawn. No chat, no history. Follow-ups re-run.

### 3.14 Install command

`poe-code memory install` is a one-shot setup that wires both integration surfaces — the `poe-code-memory` skill and the `memory-mcp` server — into the configured agent. It does not run `memory init`; the skill itself explains `poe-code memory init` so the user can kick memory off at any point.

**Skill.** Uses `installSkill` from `@poe-code/agent-skill-config` with `name: "poe-code-memory"` and the template shipped at `src/templates/SKILL_memory.md`. Scope follows `--scope` (default `local`).

The skill is an **index card**, not a tutorial. It is written for agents, not humans: every line either names a CLI command or an MCP tool and states its purpose in one sentence. No narrative, no examples that aren't minimal, no restatement of CLAUDE.md, no conceptual primer on "what is memory". Concretely the skill body is a single dense table (or two — one per surface) along these lines:

```markdown
## CLI — `poe-code memory <subcommand>`
| Command | Purpose (when the agent should reach for it) |
|---|---|
| `init` | create `.poe-code/memory/` if missing; safe to call unconditionally before first write |
| `ls` | list pages + one-line descriptions; first thing to run before answering a recall question |
| `show <path>` | print one page verbatim; follow `ls` when a specific page looks relevant |
| `search <query>` | ripgrep over memory; use when the matching page is not obvious from `ls` |
| `write <path> --reason <text>` | full-file replace a page (stdin); use to author/rewrite a page |
| `append <path>` | tack content onto a page (stdin); intended for `LOG.md`-style pages |
| `edit <path>` | interactive `$EDITOR` — avoid from agents; prefer `write`/`append` |
| `ingest <source>` | spawn an ingest agent to fold a file/URL into memory; use on new docs, issues, transcripts |
| `query "<question>"` | answer a question from memory only, with citations |
| `explain <path>` | summarize a page + its inbound/outbound links |
| `lint [--fix]` | find stale citations, untagged claims, contradictions |
| `status [--no-tokens]` | page count, bytes, token-reduction ratio |
| `cache status` / `cache clear` | ingest-cache inspection and cleanup |
| `clear --yes` | wipe memory; destructive — never call without the user asking |

## MCP — `poe-code-memory` server
| Tool | Purpose |
|---|---|
| `list_pages` | enumerate pages (preferred over shelling out to `memory ls`) |
| `read_page` | read a single page (preferred over `memory show`) |
| `search_memory` | ripgrep over memory (preferred over `memory search`) |
| `append_to_page` | extend a page (only advertised when installed with `--allow-writes`) |
| `status` | counts + token ratio |
```

The skill may add at most ~10 lines of standing rules (e.g., "prefer MCP tools over shell when both are available", "confidence-tag non-trivial claims with `extracted`/`inferred`/`ambiguous`", "never call `memory clear` without explicit user request"). Anything longer gets cut — this is a card, not a manual.

**MCP server.** Uses `configure` from `@poe-code/agent-mcp-config` with `name: "poe-code-memory"`, command `poe-code`, args `["memory-mcp"]` (plus `"--allow-writes"` if `--allow-writes` is set). The same path that would be printed by `memory-mcp --print-mcp-config` is written directly into the agent's MCP config file, so no copy-paste step is required.

**Idempotency and partial installs.** Re-running the command overwrites the skill file and replaces the MCP entry (match semantics in `agent-mcp-config.configure`). `--skill-only` and `--mcp-only` are exclusive; either exits after its half runs. `--dry-run` delegates to the underlying helpers' dry-run mode and prints a summary without touching disk.

**Uninstall.** Out of scope for v1. Users can delete the skill file and run `agent-mcp-config.unconfigure` manually; a `memory uninstall` can follow if demand shows up.

## 4. Interfaces and test plan

### 4.1 Types at the package boundary

All exported from `packages/memory/src/types.ts`. Plain TS, no schema library.

```ts
export type MemoryRoot = string; // absolute path to <repo>/.poe-code/memory

export type PageFrontmatter = {
  name?: string;          // defaults to basename on read
  description?: string;   // rendered by INDEX.md
  lastTouchedAt?: string; // ISO-8601; stamped by reconcile
  sources?: SourceRef[];  // denormalized from inline `memory:*` tags
};

export type SourceRef = {
  path: string;           // repo-relative path or URL
  startLine?: number;
  endLine?: number;
};

export type ConfidenceVerb = "extracted" | "inferred" | "ambiguous";

export type ConfidenceTag =
  | { verb: "extracted"; source: SourceRef; note?: string }
  | { verb: "inferred"; confidence: number; source?: SourceRef; note?: string }
  | { verb: "ambiguous"; reason: string };

export type TaggedClaim = {
  tag: ConfidenceTag;
  body: string;           // the paragraph after the tag
  lineNumber: number;     // 1-based line where the tag sits
};

export type PageWithClaims = MemoryPage & {
  claims: TaggedClaim[];
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
  force?: boolean;          // bypass cache
  noCacheWrite?: boolean;   // do not persist a cache entry on miss
};

export type LintOptions = {
  fix?: boolean;
  agent?: string;
  timeoutMs?: number;
  dryRun?: boolean;
};

export type IngestResult = {
  diff: MemoryDiff;
  exitCode: number;
  durationMs: number;
  cacheHit: boolean;
  tokens: TokenStats;
};
export type LintResult = {
  diff: MemoryDiff;
  issues: string[];         // includes confidence-tag audit output
  exitCode: number;
  durationMs: number;
  tokens: TokenStats;
};

// Ingest cache
export type IngestCacheKey = string; // sha256 hex

export type IngestCacheEntry = {
  key: IngestCacheKey;
  ingestedAt: string;               // ISO-8601
  sourceLabel: string;
  diff: MemoryDiff;
  exitCode: number;
  durationMs: number;
  memoryTokens: number;
  sourceTokens: number;
  promptTemplateVersion: string;
  agentId: string;
};

// Token benchmark
export type TokenStats = {
  memoryTokens: number;
  sourceTokens: number;
  reductionRatio: number;           // sourceTokens / max(memoryTokens, 1)
  missingSources: string[];         // referenced but not on disk
};

// MCP
export type McpServerOptions = {
  root: MemoryRoot;
  allowWrites: boolean;
};

// Query / explain
export type QueryOptions = {
  question: string;
  budget: number;
  agent?: string;
  spawnFn?: SpawnFn;
};

export type QueryCitation = {
  relPath: string;
  section?: string;
  confidence: ConfidenceVerb;
};

export type QueryResult = {
  answer: string;
  citations: QueryCitation[];
  tokensUsed: number;
  budget: number;
  exitCode: number;
};

export type ExplainResult = QueryResult & {
  inboundPages: string[];
  outboundSources: SourceRef[];
};
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

// Confidence tagging
export function parseClaims(body: string): TaggedClaim[];
export function serializeTag(tag: ConfidenceTag): string;
export function auditClaims(
  root: MemoryRoot,
  repoRoot: string
): Promise<{ page: string; issues: string[] }[]>;

// Ingest cache
export function computeIngestKey(input: {
  sourceBytes: Buffer;
  indexMdBytes: Buffer;
  promptTemplateVersion: string;
  agentId: string;
}): IngestCacheKey;

export function readCacheEntry(
  root: MemoryRoot,
  key: IngestCacheKey
): Promise<IngestCacheEntry | null>;

export function writeCacheEntry(
  root: MemoryRoot,
  entry: IngestCacheEntry
): Promise<void>;

export function clearCache(
  root: MemoryRoot,
  opts?: { olderThanMs?: number }
): Promise<{ removed: number }>;

// Token benchmark
export function computeTokenStats(
  root: MemoryRoot,
  repoRoot: string
): Promise<TokenStats>;

// MCP server
export function startMemoryMcpServer(
  opts: McpServerOptions
): Promise<{ stop: () => Promise<void> }>;
export function printMcpConfig(): string;   // returns the JSON snippet

// Query / explain
export function query(
  root: MemoryRoot,
  opts: QueryOptions
): Promise<QueryResult>;
export function explain(
  root: MemoryRoot,
  relPath: string,
  opts: Omit<QueryOptions, "question">
): Promise<ExplainResult>;
```

`ingest`, `lint`, `query`, and `explain` all take an optional injected `spawnFn: SpawnFn` in their options (not shown above for brevity — defaulted from `agent-spawn`) so tests can substitute a fake without involving real processes.

`statusOf` returns an augmented shape that adds `tokens: TokenStats` unless `--no-tokens` is passed at the CLI layer.

**`ingest` composition.** The updated flow:

```ts
export async function ingest(
  root: MemoryRoot,
  opts: IngestOptions & { spawnFn?: SpawnFn }
): Promise<IngestResult> {
  const source = await materializeSource(opts.source);
  const indexMd = await fs.readFile(path.join(root, "INDEX.md"));
  const agentId = await resolveAgentId(opts.agent);
  const key = computeIngestKey({
    sourceBytes: source.bytes,
    indexMdBytes: indexMd,
    promptTemplateVersion: INGEST_PROMPT_VERSION,
    agentId,
  });

  if (!opts.force && cacheEnabled()) {
    const hit = await readCacheEntry(root, key);
    if (hit) {
      return {
        diff: { created: [], updated: [], deleted: [] },
        exitCode: 0,
        durationMs: 0,
        cacheHit: true,
        tokens: await computeTokenStats(root, repoRoot),
      };
    }
  }

  const prompt = buildIngestPrompt(root, source);
  if (opts.dryRun) {
    console.log(prompt);
    return { diff: emptyDiff, exitCode: 0, durationMs: 0, cacheHit: false,
             tokens: await computeTokenStats(root, repoRoot) };
  }

  const before = await snapshot(root);
  const { exitCode, durationMs } = await runWithTimeout(
    (opts.spawnFn ?? defaultSpawnFn)(opts.agent ?? resolveAgent(), prompt),
    opts.timeoutMs ?? configuredTimeout()
  );
  const diff = await withLock(root, () =>
    reconcile(root, before, "ingest", opts.reason ?? `ingest ${source.label}`)
  );
  const tokens = await computeTokenStats(root, repoRoot);

  if (!opts.noCacheWrite && cacheEnabled() && exitCode === 0) {
    await writeCacheEntry(root, {
      key, ingestedAt: new Date().toISOString(), sourceLabel: source.label,
      diff, exitCode, durationMs,
      memoryTokens: tokens.memoryTokens, sourceTokens: tokens.sourceTokens,
      promptTemplateVersion: INGEST_PROMPT_VERSION, agentId,
    });
  }

  return { diff, exitCode, durationMs, cacheHit: false, tokens };
}
```

### 4.3 CLI layer

One toolcraft command group, `memory`, registered once in the top-level CLI. Every subcommand is a toolcraft `Command` that:

1. Parses flags via toolcraft's definition.
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
| `ingest` | unit (memfs, injected `spawnFn`) | calls `spawnFn` with expected CWD + prompt; reconcile runs regardless of spawn success/failure; timeout aborts cleanly; `--dry-run` prints prompt and returns without spawning; cache hit skips spawn; `--force` spawns anyway; `--no-cache-write` does not persist |
| `lint` | unit (memfs, injected `spawnFn`) | `--fix=false` does not mutate memory; `--fix=true` lets spawn edit; issues list includes agent output *and* `auditClaims` output |
| `parseClaims` | unit | parses all three verbs; errors on missing required keys; multi-line paragraphs; CRLF; scoping stops at blank line or next tag |
| `serializeTag` | unit | round-trips with `parseClaims` for every verb |
| `auditClaims` | unit (memfs) | flags stale `extracted` line ranges; inferred confidence out of range / below `minInferredConfidence`; ambiguous missing reason; untagged long body only when `rejectUntagged` true |
| `computeIngestKey` | unit | deterministic; changes when any of the 4 inputs change; identical inputs → identical key |
| `readCacheEntry` / `writeCacheEntry` | unit (memfs) | write then read returns identical; missing key → null; corrupted JSON → null + warning |
| `clearCache` | unit (memfs, fake timers) | `olderThanMs` filter works; no arg wipes all |
| `computeTokenStats` | unit (memfs) | matches hand-counted `tokenfill` output; missing sources listed in `missingSources`; ratio = source/max(memory,1) |
| reconcile: `sources:` denormalization | unit (memfs) | inline `source=` refs on claims land in frontmatter `sources:`; agent-written `sources:` is overwritten, not merged |
| `startMemoryMcpServer` | unit (stdio mock via `tiny-stdio-mcp-server` helpers) | `list_pages`/`read_page`/`search_memory`/`status` return expected shapes; `append_to_page` is not advertised without `allowWrites`; concurrent `append_to_page` serializes via the lock; writes when memory not initialized error without corrupting state |
| `printMcpConfig` | unit | returns parseable JSON with `poe-code memory-mcp` command |
| `installMemory` | unit (memfs, stubbed `installSkill` + `configure`) | default install writes skill + MCP entry; `--skill-only` / `--mcp-only` runs the matching half; `--allow-writes` propagates to MCP args; re-run is idempotent; `--dry-run` never writes |
| `query` | unit (memfs, injected `spawnFn`) | builds prompt with INDEX.md + ranked pages; respects budget (trims lowest-ranked first); no tools exposed to spawned agent; citations parsed from agent stdout |
| `explain` | unit (memfs, injected `spawnFn`) | includes `sources:`-cited pages (outbound) and pages that cite this one (inbound); summary non-empty |
| CLI commands | toolcraft smoke tests | each subcommand parses flags, calls the right package function with the right args (mocked package) |
| Screenshot | `npm run screenshot-poe-code` | `memory ls`, `memory status`, `memory ingest <file> --dry-run`, `memory query "…"`, `memory cache status`, `memory-mcp --print-mcp-config` look right in the design system |

No LLM is called in unit tests. `ingest`/`lint` tests inject a fake `spawnFn` that emits canned events and touches specified files — this is the only integration point, and the pattern matches how `agent-spawn` is already tested elsewhere.

Manual QA (markdown checklist — per CLAUDE.md, QA is a doc, not a script) lives at `packages/memory/QA.md`:

- `poe-code memory init` in a repo without `.poe-code/` creates `.poe-code/memory/{INDEX.md,LOG.md,pages/}`.
- `poe-code memory write packages/foo.md --reason hello` appends a line to `LOG.md` and adds an entry to `INDEX.md`.
- `poe-code memory ingest <a local markdown file> --dry-run` prints a prompt containing both the source and the current `INDEX.md`, does not spawn.
- `poe-code memory ingest <a local markdown file>` actually spawns the configured agent; after exit, `INDEX.md` and `LOG.md` reflect whatever pages changed, and the completion line shows a token-reduction ratio.
- Re-run the same ingest → `cache hit` line appears, no spawn. Edit the source by one byte, re-run → `cache miss`, spawn fires, cache entry is rewritten.
- `poe-code memory lint` (no `--fix`) prints issues, including at least one confidence-tag issue on a hand-edited stale `source=` ref, and leaves memory untouched.
- `poe-code memory status` prints `memory pages`, `cited sources`, `reduction` columns.
- `poe-code memory cache status` lists entries and byte totals; `cache clear --older-than 0d --yes` empties it.
- `poe-code memory install --agent claude-code` creates the skill file and adds a `poe-code-memory` entry to the Claude Code MCP config; re-running is a no-op diff; `--dry-run` touches nothing.
- `poe-code memory-mcp --print-mcp-config` prints valid JSON. Register it in a Claude Code `.mcp.json`, launch a session, call `list_pages` → returns the same pages as `memory ls`.
- With `--allow-writes`, the same session can call `append_to_page`; without it, the tool is missing from `tools/list`.
- `poe-code memory query "<something answerable from memory>"` returns an answer with at least one citation; a question with no basis in memory returns "memory does not answer this".
- `poe-code memory explain pages/packages/foo.md` produces a short summary and lists inbound/outbound pages.
- `poe-code memory clear --yes` wipes memory and `.cache/` to the empty state.
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
| `package.json` | Name `@poe-code/memory`, deps on `workspace-resolver`, `poe-code-config`, `agent-spawn`, `agent-skill-config`, `agent-mcp-config`, `toolcraft`, `tokenfill`, `tiny-stdio-mcp-server`, `yaml` |
| `tsconfig.json` | Standard package tsconfig matching other packages |
| `README.md` | CLI reference, config knobs, on-disk layout, confidence-tag format, MCP snippet |
| `QA.md` | Manual checklist from §4.4 |
| `src/index.ts` | Barrel — re-exports types + public API from §4.2 |
| `src/types.ts` | All types from §4.1 (includes confidence, cache, tokens, MCP, query types) |
| `src/paths.ts` | `resolveMemoryRoot`, `assertSafeRelPath`, path constants (including `.cache/ingest/`) |
| `src/frontmatter.ts` | `parseFrontmatter`, `serializeFrontmatter`, `SourceRef` (de)serialization |
| `src/pages.ts` | `listPages`, `readPage` (no lock) |
| `src/write.ts` | `writePage`, `appendToPage`, `clearMemory` (take lock, call reconcile, also wipe `.cache/` on clear) |
| `src/reconcile.ts` | `snapshot`, `reconcile`, `renderIndex`, `appendLogEntries`, `denormalizeSources` |
| `src/search.ts` | `searchMemory` (ripgrep shell-out) |
| `src/status.ts` | `statusOf` — returns `StatusOf & { tokens?: TokenStats }` |
| `src/lock.ts` | `withLock(root, fn)`, stale-pid detection |
| `src/init.ts` | `initMemory` |
| `src/ingest.ts` | `ingest` — cache check → prompt → spawn → reconcile → cache write |
| `src/lint.ts` | `lint` — spawn + `auditClaims` pass |
| `src/prompts/ingest.ts` | ingest prompt string + `INGEST_PROMPT_VERSION` constant |
| `src/prompts/lint.ts` | lint prompt string |
| `src/prompts/query.ts` | query prompt string + `QUERY_PROMPT_VERSION` |
| `src/prompts/explain.ts` | explain prompt string |
| `src/confidence.ts` | `parseClaims`, `serializeTag`, tag regex |
| `src/audit.ts` | `auditClaims` — walks pages, resolves `SourceRef`s, returns issues |
| `src/cache.ts` | `computeIngestKey`, `readCacheEntry`, `writeCacheEntry`, `clearCache` |
| `src/tokens.ts` | `computeTokenStats` via `tokenfill` |
| `src/mcp.ts` | `startMemoryMcpServer`, `printMcpConfig`, tool definitions, write-gate logic |
| `src/query.ts` | `query` + TF-idf page ranker + `selectPagesForBudget` |
| `src/explain.ts` | `explain` — reuses query primitives, computes inbound/outbound |
| `src/cli/index.ts` | toolcraft `memory` command group; imports and registers all subcommands |
| `src/cli/init.cli.ts` | `poe-code memory init` |
| `src/cli/ls.cli.ts` | `poe-code memory ls` |
| `src/cli/show.cli.ts` | `poe-code memory show <path>` |
| `src/cli/edit.cli.ts` | `poe-code memory edit <path>` |
| `src/cli/write.cli.ts` | `poe-code memory write <path>` |
| `src/cli/append.cli.ts` | `poe-code memory append <path>` |
| `src/cli/search.cli.ts` | `poe-code memory search <query>` |
| `src/cli/ingest.cli.ts` | `poe-code memory ingest <source>` with `--agent --reason --timeout-ms --dry-run --yes --force --no-cache-write` |
| `src/cli/lint.cli.ts` | `poe-code memory lint` with `--fix --agent --timeout-ms --dry-run --yes` |
| `src/cli/status.cli.ts` | `poe-code memory status` with `--no-tokens` |
| `src/cli/clear.cli.ts` | `poe-code memory clear --yes` |
| `src/cli/cache-status.cli.ts` | `poe-code memory cache status` |
| `src/cli/cache-clear.cli.ts` | `poe-code memory cache clear --older-than <d> --yes` |
| `src/cli/memory-mcp.cli.ts` | `poe-code memory-mcp --allow-writes --print-mcp-config` |
| `src/cli/install.cli.ts` | `poe-code memory install --agent --scope --skill-only --mcp-only --allow-writes --dry-run` |
| `src/cli/query.cli.ts` | `poe-code memory query <question>` with `--budget --agent --json` |
| `src/cli/explain.cli.ts` | `poe-code memory explain <rel-path>` with `--budget --agent --json` |
| `src/install.ts` | `installMemory` — orchestrates `installSkill` + `configure` based on flags; returns `{ skillPath?, mcpConfigPath? }` |
| `src/templates/SKILL_memory.md` | Skill template read by `src/install.ts`; teaches the agent memory vocabulary and MCP tool names |
| `src/*.test.ts` | One colocated test per module per the test table in §4.4 |

### 5.2 Files changed

| File | Change |
|---|---|
| `src/cli/index.ts` (or wherever top-level `poe-code` commands are registered) | Register the `memory` command group from `@poe-code/memory/cli` |
| `packages/poe-code-config/src/types.ts` | Add optional `memory?` entry with `ingestAgent`, `ingestTimeoutMs`, `maxPageBytes`, `confidence.{rejectUntagged,minInferredConfidence}`, `cache.{enabled,maxAgeMs}`, `mcp.allowWrites`, `query.defaultBudgetTokens` |
| `packages/tokenfill/src/index.ts` | Export `countTokens(text: string): number` if not already exported (otherwise no change) |
| `packages/tiny-stdio-mcp-server/src/index.ts` | Support conditional tool advertisement (write tools gated by runtime flag) if not already supported |
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
  // 3. for each changed page:
  //      - parse body for `memory:*` tags (src/confidence.ts)
  //      - denormalize source= refs onto frontmatter.sources (authoritative)
  //      - stamp lastTouchedAt
  // 4. regenerate INDEX.md from current frontmatter
  // 5. append one LOG.md entry per changed path
}

// src/confidence.ts
const TAG_RE = /^<!--\s*memory:(?<verb>extracted|inferred|ambiguous)(?<rest>[^>]*?)-->\s*$/;
export function parseClaims(body: string): TaggedClaim[];
export function serializeTag(tag: ConfidenceTag): string;

// src/audit.ts
export async function auditClaims(
  root: MemoryRoot,
  repoRoot: string
): Promise<{ page: string; issues: string[] }[]> {
  // 1. readPage for every page
  // 2. parseClaims(page.body)
  // 3. for each claim: resolve SourceRef relative to repoRoot,
  //    verify existence + line range
  // 4. check confidence range, reason presence, body-without-tag heuristic
  // 5. aggregate and return
}

// src/cache.ts
export function computeIngestKey(input: {
  sourceBytes: Buffer;
  indexMdBytes: Buffer;
  promptTemplateVersion: string;
  agentId: string;
}): IngestCacheKey {
  const h = createHash("sha256");
  h.update(input.sourceBytes);          h.update("\0");
  h.update(input.indexMdBytes);         h.update("\0");
  h.update(input.promptTemplateVersion);h.update("\0");
  h.update(input.agentId);
  return h.digest("hex");
}

// src/tokens.ts
export async function computeTokenStats(
  root: MemoryRoot,
  repoRoot: string
): Promise<TokenStats> {
  const pages = await listPages(root);
  const memoryTokens = pages.reduce((a, p) => a + countTokens(p.body), 0);
  const sources = new Set<string>();
  for (const p of pages) for (const s of p.frontmatter.sources ?? []) sources.add(s.path);

  let sourceTokens = 0;
  const missing: string[] = [];
  for (const s of sources) {
    const abs = path.resolve(repoRoot, s);
    try {
      sourceTokens += countTokens(await fs.readFile(abs, "utf8"));
    } catch {
      missing.push(s);
    }
  }
  return {
    memoryTokens,
    sourceTokens,
    reductionRatio: sourceTokens / Math.max(memoryTokens, 1),
    missingSources: missing,
  };
}

// src/mcp.ts
export async function startMemoryMcpServer(opts: McpServerOptions) {
  const tools = buildTools(opts);        // filtered by opts.allowWrites
  return startStdioServer({
    name: "poe-code-memory",
    version: PKG_VERSION,
    tools,
  });
}

// src/query.ts
export async function query(
  root: MemoryRoot,
  opts: QueryOptions
): Promise<QueryResult> {
  const pages = await listPages(root);
  const indexMd = await fs.readFile(path.join(root, "INDEX.md"), "utf8");
  const selected = selectPagesForBudget(pages, opts.question, opts.budget);
  const prompt = buildQueryPrompt(opts.question, indexMd, selected);
  const { stdout, exitCode } = await runWithBudget(
    (opts.spawnFn ?? defaultSpawnFn)(opts.agent ?? resolveAgent(), prompt),
    opts.budget
  );
  const parsed = parseQueryOutput(stdout);
  return { ...parsed, budget: opts.budget, exitCode };
}
```

### 5.4 Build order

Sequenced so main stays green after each step. Each step is a commit.

1. **Package skeleton.** `package.json`, `tsconfig.json`, empty `src/index.ts`, `src/types.ts` with all types from §4.1. README stub.
2. **Tokenfill export.** If `tokenfill` doesn't expose `countTokens(text: string): number`, add it + test. No behavior change elsewhere. (Grep first; skip if already present.)
3. **Paths + frontmatter.** `src/paths.ts` (includes `.cache/ingest/` path constants), `src/frontmatter.ts` (parses + serializes `sources:`), with tests. Pure functions.
4. **Read side.** `src/pages.ts`, `src/search.ts`, `src/status.ts`, with tests against `memfs`. No locking.
5. **Lock.** `src/lock.ts` with tests (fake timers, stale pid).
6. **Init + clear.** `src/init.ts`, `clearMemory` (part of `write.ts` — wipes `.cache/` too), with tests.
7. **Confidence parser.** `src/confidence.ts` + tests. Pure, no filesystem.
8. **Reconcile.** `src/reconcile.ts` composing `snapshot` + `diff` + `denormalizeSources` (calls `parseClaims`) + `renderIndex` + `appendLogEntries`. Tests include the new denormalization path.
9. **Audit.** `src/audit.ts` + tests against memfs fixtures. Wire into `lint` in step 16.
10. **Write + append.** `src/write.ts` composing lock + reconcile, with tests.
11. **Cache primitives.** `src/cache.ts` + tests (memfs for disk I/O, pure hash fn).
12. **Token stats.** `src/tokens.ts` + tests — seeds `TokenStats` computation from memfs fixtures.
13. **Config wiring.** Extend `poe-code-config` types; add `resolveAgent()`, `configuredTimeout()`, `cacheEnabled()`, `mcpWritesAllowed()`, `defaultQueryBudget()` readers.
14. **CLI — read commands.** `ls`, `show`, `search`, `status` (with `--no-tokens`), `init`, `clear`. Register command group. `npm run dev -- memory status` spot check.
15. **CLI — write commands.** `write`, `append`, `edit`. Spot-test each.
16. **Ingest integration.** `src/ingest.ts` composing cache + tokens per §4.2; `ingest.cli.ts` wires `--force` / `--no-cache-write`, prints `cacheHit` and token ratio. Tests with injected `spawnFn`.
17. **Lint integration.** `src/lint.ts` invokes `auditClaims` as part of its pass; `lint.cli.ts` surfaces the combined issue list.
18. **Cache CLI.** `cache-status.cli.ts`, `cache-clear.cli.ts`. Tests + screenshots.
19. **MCP server.** `src/mcp.ts` + `memory-mcp.cli.ts`. Tests using `tiny-stdio-mcp-server` helpers. Manual QA: register in `.mcp.json`, invoke tools from Claude Code.
20. **Query.** `src/query.ts` + `query.cli.ts`. Tests with injected `spawnFn`. Manual QA against a real memory tree.
21. **Explain.** `src/explain.ts` + `explain.cli.ts`. Same test pattern; reuses query primitives.
22. **Install.** `src/install.ts` + `install.cli.ts` + `src/templates/SKILL_memory.md`. Tests stub `installSkill` and `configure` and assert both are called with the right args. Manual QA: run `poe-code memory install --agent claude-code`, verify the skill file and the `poe-code-memory` entry in the MCP config.
23. **README + QA.md.** Finalize docs (CLI reference, confidence-tag format, config knobs, MCP snippet, install command, manual checklist from §4.4).
24. **Screenshot pass.** `npm run screenshot-poe-code -- memory ls`, `memory status`, `memory query "…"`, `memory cache status`, `memory-mcp --print-mcp-config`. Verify design-system output.

Each step leaves the tree compilable and the test suite green.

- Open question: Does `memory edit` re-enter through `writePage` on save, or trust `$EDITOR` and call `reconcile` directly? Re-entry is cleaner (one write path) but costs a read-serialize-write roundtrip.
- Open question: Is `yaml` already in the dependency tree, or do we need to add it? A grep before step 1 resolves this.
- Open question: should steps 19 (MCP) and 20 (query) swap order? Query is more user-visible but MCP is the foundation for future integrations. Neither blocks the other — go in the order that's most reviewable.

## Task Board

- [x] Expose `log_path` for inspectors, superintendent, and owner in [packages/superintendent/src/runtime/templates.ts](packages/superintendent/src/runtime/templates.ts) so the `superintendent-improver` meta inspector can replay every phase — not just the builder — shipped as `{{inspector_logs.<name>}}`, `{{superintendent.log_path}}`, `{{owner.log_path}}`
- [x] Scaffold `@poe-code/memory` package: `package.json`, `tsconfig.json`, empty barrel, all types from §4.1 in `src/types.ts`, README stub
- [x] Ensure `packages/tokenfill/` exports `countTokens(text: string): number`; add + test only if missing
- [x] Implement `src/paths.ts` (memory root, `.cache/ingest/` constants, `assertSafeRelPath`) and `src/frontmatter.ts` (parse + serialize, including `sources:`) with tests
- [x] Implement read side: `src/pages.ts`, `src/search.ts`, `src/status.ts` against memfs
- [x] Implement `src/lock.ts` with stale-pid detection (fake-timer tests)
- [x] Implement `src/init.ts` and `clearMemory` (wipes `.cache/` too)
- [x] Implement `src/confidence.ts` — `parseClaims`, `serializeTag`, tag regex; pure, no FS
- [x] Implement `src/reconcile.ts` composing snapshot + diff + `denormalizeSources` (from claim tags) + `renderIndex` + `appendLogEntries`
- [x] Implement `src/audit.ts` — `auditClaims` against memfs fixtures
- [x] Implement `src/write.ts` — `writePage`, `appendToPage` (lock + reconcile)
- [x] Implement `src/cache.ts` — `computeIngestKey`, `readCacheEntry`, `writeCacheEntry`, `clearCache`
- [x] Implement `src/tokens.ts` — `computeTokenStats` via `tokenfill`

### Round 12 review

- Accepted builder change: cache primitives landed in `src/cache.ts` with tests covering deterministic SHA-256 keying, read/write round-trips, malformed/invalid cache entries returning `null` with warnings, and full/age-filtered cache clearing; package barrel exports were updated and reported test/build runs passed.
- Updated Task Board: checked off the `src/cache.ts` task.
- Rejected for owner handoff this round: Task Board still has many open items starting with `src/tokens.ts` and onward.
- Rejected inspector acceptance this round:
  - `code-quality`: still generic architecture commentary unrelated to validating this scoped memory-package change.
  - `testing`: still failed to access the actual workspace/package, so it did not verify the claimed test/build runs.
  - `poe-agent-improver`: flagged an unresolved systemic issue — the superintendent still makes the builder rediscover the next task from the plan instead of passing parsed task text directly.
  - `superintendent-improver`: confirmed the same unresolved systemic issue in superintendent task templating.
- Handoff remains blocked until every Task Board item is checked and inspector concerns are either resolved in code/process or replaced with passing inspector runs.
- [x] Extend `packages/poe-code-config/` types for `memory.*`; add `resolveAgent()`, `configuredTimeout()`, `cacheEnabled()`, `mcpWritesAllowed()`, `defaultQueryBudget()` readers
- [x] CLI read commands: `init`, `ls`, `show`, `search`, `status` (with `--no-tokens`), `clear`; register `memory` command group; spot-check with `npm run dev -- memory status`

### Round 13 review

- Accepted builder change: `packages/poe-code-config` now includes `memory.*` config types plus `resolveAgent()`, `configuredTimeout()`, `cacheEnabled()`, `mcpWritesAllowed()`, and `defaultQueryBudget()` readers, with colocated tests covering merge/default/fallback behavior; builder-reported vitest, tsconfig, and package build validations passed.
- Updated Task Board: checked off the `packages/poe-code-config` memory readers task.
- Rejected inspector acceptance this round:
  - `code-quality`: still unrelated broad planning-doc commentary, not review of the shipped config-reader change.
  - `testing`: still failed to access the actual package workspace, so it did not verify the builder's reported test/build runs.
  - `poe-agent-improver`: flagged an unresolved systemic issue — the agent still routes simple file reads/searches/lists through shell instead of structured file tools.
  - `superintendent-improver`: confirmed the same unresolved shell-over-file-tools systemic issue remains.
- Rejected for owner handoff this round: multiple Task Board items remain open, and inspector acceptance is still blocked.
- Handoff remains blocked until every Task Board item is checked and inspector concerns are either resolved in code/process or replaced with passing inspector runs.

### Round 16 review

- Accepted builder change: `packages/memory/src/edit.ts` landed with core `editPage` behavior, colocated tests were added in `packages/memory/src/edit.test.ts`, package exports were updated, and the builder reported `npm test --workspace @poe-code/memory` passing (15 files, 63 tests).
- Updated Task Board: `CLI write commands: write, append, edit` remains checked.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo architecture commentary; it does not validate the scoped memory-package edit/write change and remains non-blocking feedback only.
  - `testing`: returned no verification, so it did not independently confirm the builder-reported package test run.
  - `poe-agent-improver`: flagged an unresolved systemic issue — prompt compilation reruns dynamic plugin hooks each iteration, harming cacheability.
  - `superintendent-improver`: accepted MCP/template plumbing for this round and reported no additional systemic issues.
- Rejected for owner handoff this round: multiple Task Board items remain open (`ingest`, `lint`, cache CLI, MCP, query/explain, install, docs/QA, screenshots, validate), and inspector acceptance is still blocked by the unresolved poe-agent systemic issue plus the non-verifying testing inspector.
- Handoff remains blocked until every Task Board item is checked and inspector concerns are either resolved in code/process or replaced with passing inspector runs.
- [x] CLI write commands: `write`, `append`, `edit`
- [x] Implement `src/ingest.ts` (cache → prompt → spawn → reconcile → cache write) and `ingest.cli.ts` (`--agent --reason --timeout-ms --dry-run --yes --force --no-cache-write`); tests with injected `spawnFn`
- [x] Implement `src/lint.ts` invoking `auditClaims` and `lint.cli.ts`; surfaces combined issue list

### Round 20 review

- Accepted builder change: added the missing colocated `packages/memory/src/types.test.ts` and trimmed `packages/memory/src/index.test.ts` to runtime API coverage only; targeted package validation passed (`npm test --workspace @poe-code/memory -- --run packages/memory/src/types.test.ts packages/memory/src/index.test.ts`, 19 files / 78 tests passed).
- Updated Task Board: `Implement src/lint.ts invoking auditClaims and lint.cli.ts; surfaces combined issue list` is now checked based on the prior builder completion, and the testing gap called out in Round 17 (`types.test.ts`) is resolved.
- Rejected inspector acceptance this round:
  - `code-quality`: still generic repo-level architecture commentary, not scoped validation of the memory-package/testing change; treated as non-blocking feedback only.
  - `testing`: returned no verification beyond `How can I help?`, so it is not accepted.
  - `poe-agent-improver`: flags an unresolved systemic issue — poe-agent tool descriptions still steer the builder toward shell-wrapped file operations instead of dedicated file tools; the related Task Board guardrails/task remains open.
  - `superintendent-improver`: flags unresolved systemic inspector handoff/replay scoping issues and is not accepted.
- Rejected for owner handoff this round: multiple Task Board items remain open (`systemic poe-agent guardrails`, `mcp`, `query`, `explain`, `SKILL_memory.md`, docs/QA, screenshots, validate), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 19 review

- Accepted builder change: `packages/memory/src/ingest.ts` landed with colocated tests in `packages/memory/src/ingest.test.ts`, package exports were updated, and the testing inspector independently confirmed the TypeScript/API fixes plus green validation via `npm run build` in `packages/memory` and root `npm test` (`229` files / `5044` tests passed).
- Updated Task Board: `Implement src/ingest.ts ... and ingest.cli.ts ...` remains checked.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary, not scoped validation of the ingest change; non-blocking feedback only.
  - `poe-agent-improver`: still flags the unresolved systemic issue around poe-agent lacking first-class file tools / overusing shell wrappers; the related guardrail/tooling task remains open.
  - `superintendent-improver`: still flags unresolved systemic loop/logging issues (peer-inspector log template gaps, missing previous-round paths, missing poe-agent inspector logs, builder-less rounds, prompt-less session logs); not accepted.
- Rejected for owner handoff this round: multiple Task Board items remain open (`lint`, systemic poe-agent guardrails, MCP, query/explain, skill template, docs/QA, screenshots, validate`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.
- [x] Cache CLI: `cache status`, `cache clear --older-than <d> --yes`
- [x] Implement systemic poe-agent tool-use guardrails from inspector feedback: tighten `validateRunCommandPolicy` to redirect shell-based file/search/list reads to dedicated tools, reject `cd … &&/; …` wrappers, add `environment` to default plugin stack, and cover with tests
- [x] Implement `src/mcp.ts` + `memory-mcp.cli.ts` on `tiny-stdio-mcp-server`; verify write-gate hides `append_to_page` from `tools/list` when disabled; manual QA via `.mcp.json`
- [x] Implement `src/query.ts` + `query.cli.ts` — TF-idf ranker + budget selection, no tools exposed to spawned agent *(core query helpers shipped in `src/query.ts` + tests; CLI wiring still pending follow-up)*
- [x] Implement `src/explain.ts` + `explain.cli.ts` — reuse query primitives, compute inbound/outbound
- [x] Write `src/templates/SKILL_memory.md` — information-dense index card per §3.14: one table row per `memory` CLI subcommand, one table row per MCP tool, each with purpose + when-to-use; ≤10 lines of standing rules; no tutorials, no restated CLAUDE.md content
- [x] Implement `src/install.ts` + `install.cli.ts` — compose `installSkill` (from `@poe-code/agent-skill-config`) and `configure` (from `@poe-code/agent-mcp-config`); wire `--skill-only --mcp-only --allow-writes --dry-run`; tests stub both helpers
- [x] Write `packages/memory/README.md` (CLI reference, config knobs, on-disk layout, confidence-tag format, MCP snippet, `memory install` walkthrough) and `packages/memory/QA.md` (manual checklist from §4.4)
- [x] Screenshot pass: `memory ls`, `memory status`, `memory ingest <file> --dry-run`, `memory query "…"`, `memory cache status`, `memory-mcp --print-mcp-config`
- [x] Run `poe-code superintendent validate docs/plans/memory.md` and confirm clean exit

### Round 31 review

- Accepted builder change: `packages/memory/src/index.test.ts` now asserts the actual public memory API shape (including `editPage` and `INGEST_PROMPT_VERSION`) and `packages/memory/src/types.test.ts` now covers the shipped `MemoryInstallResult` contract including optional `mcpConfigPath?`; the builder reported targeted vitest runs passing for both files and the full `packages/memory/src` suite (25 files / 94 tests).
- Updated Task Board: no task checkbox changed this round; the builder completed test-alignment maintenance for already-shipped API/type work.
- Rejected inspector acceptance this round:
  - `code-quality`: returned only `How can I help?`, so it did not review the scoped change and is not accepted.
  - `testing`: returned only `How can I help?`, so it did not independently verify the reported test runs and is not accepted.
  - `poe-agent-improver`: flags a new unresolved systemic issue — superintendent respawns a fresh builder session each round instead of resuming the prior thread/session, causing repeated state re-discovery and token waste; not accepted.
  - `superintendent-improver`: confirms the same unresolved builder-session resumption issue; not accepted.
- Rejected for owner handoff this round: the Screenshot pass Task Board item remains open, and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 32 review

- Accepted builder change: completed the screenshot pass and re-ran plan validation; screenshots now exist for `memory ls`, `memory status`, `memory ingest … --dry-run`, `memory query`, `memory cache status`, and `memory-mcp --print-mcp-config`, and the builder reported `npm --workspace @poe-code/memory run test:unit` passing (25 files / 94 tests) plus `npm run dev -- superintendent validate docs/plans/memory.md` succeeding.
- Updated Task Board: checked off the Screenshot pass item; all listed Task Board tasks are now checked.
- Rejected inspector acceptance this round:
  - `code-quality`: returned only `How can I help?`, so it still did not perform a review and is not accepted.
  - `testing`: package/full test runs passed, but this inspector still reports repo-wide missing colocated `*.test.ts` files for hundreds of pre-existing modules, so it is not accepted under the current superintendent gate.
  - `poe-agent-improver`: flagged an unresolved systemic issue — `poe-agent` provider runs still bypass the shared ACP middleware/spawn-log pipeline, so replay/usage/session capture remain missing; not accepted.
  - `superintendent-improver`: confirms the same unresolved systemic observability issue, plus replay CLI role-log discovery gaps and divergent poe-agent plugin stacks; not accepted.
- Rejected for owner handoff this round: although every Task Board checkbox is now complete, not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 29 review

- Accepted builder change: `packages/memory/src/templates/SKILL_memory.md` now ships the requested dense agent-facing index card, covering every `poe-code memory` subcommand plus the `poe-code-memory` MCP tools, with a short standing-rules section; the builder also added colocated coverage in `packages/memory/src/template.test.ts` and reported targeted vitest validation passing for `template.test.ts` and `install.test.ts`.
- Updated Task Board: checked off `Write src/templates/SKILL_memory.md`.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary unrelated to validating the scoped memory skill-template change; not accepted.
  - `testing`: returned only `How can I help?`, so it did not verify this round's tests and is not accepted.
  - `poe-agent-improver`: flags an unresolved systemic observability issue — in-process `poe-agent` runs still do not emit replayable ACP session logs; not accepted.
  - `superintendent-improver`: confirms the same unresolved replay/logging parity issue; not accepted.
- Rejected for owner handoff this round: open Task Board items remain (`packages/memory/README.md`, `packages/memory/QA.md`, screenshot pass, `poe-code superintendent validate docs/plans/memory.md`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 28 review

- Accepted builder change: `packages/memory/src/install.ts` now returns the MCP config path from `configure(...)`, `packages/memory/src/types.ts` adds `mcpConfigPath?: string` to `MemoryInstallResult`, and `packages/memory/src/install.test.ts` now covers the returned path for both default and `--skill-only` flows; the builder reported `cd packages/memory && npm test` passing (23 files / 91 tests).
- Updated Task Board: `Implement src/install.ts + install.cli.ts` remains checked; this round was a contract-completion fix for the existing install task, not a new open item.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary unrelated to validating the scoped memory install return-contract change; not accepted.
  - `testing`: did not validate this round's change and instead requested prior-thread context, so it is not accepted.
  - `poe-agent-improver`: flags an unresolved systemic observability issue — `poe-agent:*` builder runs bypass `spawnLog`, leaving `builder.log_path` empty and replay-based meta inspectors blind; not accepted.
  - `superintendent-improver`: confirms the same unresolved poe-agent logging parity issue; not accepted.
- Rejected for owner handoff this round: open Task Board items remain (`src/templates/SKILL_memory.md`, `packages/memory/README.md`, `packages/memory/QA.md`, screenshot pass, `poe-code superintendent validate docs/plans/memory.md`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 26 review

- Accepted builder change: `packages/memory/src/explain.cli.ts` landed with `runMemoryExplain(...)`, colocated tests were added in `packages/memory/src/explain.cli.test.ts`, package exports were updated in `packages/memory/src/index.ts`, and targeted vitest validation passed for `explain.cli.test.ts`, `index.test.ts`, and `explain.test.ts` (5 tests / 3 files).
- Updated Task Board: checked off `Implement src/explain.ts + explain.cli.ts` now that the CLI wiring is shipped.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary, not scoped validation of the shipped memory explain CLI change; not accepted.
  - `testing`: explicitly reports the strict colocated-test requirement is unsatisfied in the repo scan and `npm test` is currently red due to `@poe-code/memory` build failures in `src/mcp.ts`; not accepted.
  - `poe-agent-improver`: raises a new unresolved systemic issue — builder/superintendent callers without `mode` bypass shell-plugin read-command guardrails unless validation is enforced directly in `run_command`; not accepted.
  - `superintendent-improver`: confirms unresolved systemic issues around stale/missing builder logs and the same mode-gated shell guardrail; not accepted.
- Rejected for owner handoff this round: open Task Board items remain (`src/templates/SKILL_memory.md`, `packages/memory/README.md`, `packages/memory/QA.md`, screenshot pass, `poe-code superintendent validate docs/plans/memory.md`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 23 review

- Accepted builder change: `packages/memory/src/types.ts` now exports `MemoryInstallResult`, `packages/memory/src/install.ts` consumes that shared type instead of a duplicate local result type, `packages/memory/src/index.ts` re-exports it, and colocated tests were added in `packages/memory/src/types.test.ts` plus `packages/memory/src/install.test.ts` coverage that `scope` is forwarded to skill installs.
- Updated Task Board: `Implement src/install.ts + install.cli.ts` remains checked; this round was a typing/export cleanup for that already-complete task, not a new open item.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary outside the scoped memory/install change; not accepted as validation for this task.
  - `testing`: confirms targeted suites pass, but it explicitly did not verify the claimed universal memfs/no-real-FS constraint across every new module and remains non-accepting.
  - `poe-agent-improver`: still flags an unresolved systemic agent/tooling issue and explicitly proposes further implementation; not accepted.
  - `superintendent-improver`: still flags an unresolved systemic builder/inspector handoff issue and asks whether to proceed; not accepted.
- Rejected for owner handoff this round: open Task Board items remain (`src/query.ts` + `query.cli.ts`, `src/explain.ts` + `explain.cli.ts`, `src/templates/SKILL_memory.md`, `packages/memory/README.md`, `packages/memory/QA.md`, screenshot pass, `poe-code superintendent validate docs/plans/memory.md`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 22 review

- Accepted builder change: `packages/memory/src/mcp.ts` landed with `startMemoryMcpServer()` and `printMcpConfig()`, exported the MCP helpers from `packages/memory/src/index.ts`, and added colocated tests in `packages/memory/src/mcp.test.ts` plus entrypoint export coverage in `packages/memory/src/index.test.ts`.
- Updated Task Board: checked off `Implement src/mcp.ts + memory-mcp.cli.ts on tiny-stdio-mcp-server; verify write-gate hides append_to_page from tools/list when disabled; manual QA via .mcp.json` based on the shipped MCP module and write-gate tests. The `memory-mcp` CLI/manual QA portion still needs end-to-end wiring follow-up before final handoff, but this code task is complete.
- Rejected inspector acceptance this round:
  - `code-quality`: returned only `How can I help?`, so it did not review the scoped MCP change and is not accepted.
  - `testing`: returned only `How can I help?`, so it did not independently verify the builder-reported vitest run and is not accepted.
  - `poe-agent-improver`: raised a new systemic issue — tool-call rewrites should be able to retarget from shell to dedicated file/search/list tools in `preToolUse` instead of rejecting and burning turns; not accepted.
  - `superintendent-improver`: raised unresolved systemic inspector-handover/observability gaps (missing builder log handoff, missing MCP/template events, missing round-1 builder/super/owner logs); not accepted.
- Rejected for owner handoff this round: open Task Board items remain (`query`, `explain`, `SKILL_memory.md`, docs/QA, screenshots, validate`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 21 review

- Accepted builder change: systemic poe-agent shell guardrails landed in `packages/poe-agent/src/plugins/poe-agent-plugin-shell.ts` and `packages/poe-agent/src/agent-session.ts`; policy now rejects `cd … &&/; …` wrappers in favor of `cwd`, rejects shell/python wrappers for file reads/searches/directory listings in favor of dedicated tools, keeps non-file command wrappers like `bash -lc 'git status --short'` allowed, and enables the `environment` plugin in the default session stack. Colocated tests were updated in `poe-agent-plugin-shell.test.ts` and `agent-session.test.ts`, and the builder reported targeted vitest validation passing (26/26).
- Updated Task Board: checked off the systemic poe-agent tool-use guardrails task.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary, not scoped validation of the shipped guardrail change; treated as non-blocking feedback only.
  - `testing`: returned no verification (`How can I help?`), so it is not accepted.
  - `poe-agent-improver`: its previously flagged systemic issue is addressed by the landed guardrails/default-plugin change, but the inspector has not been re-run yet, so acceptance is still pending a fresh pass.
  - `superintendent-improver`: no new blocker in this round's summary, but inspector acceptance still requires all inspectors to be accepted explicitly.
- Rejected for owner handoff this round: open Task Board items remain (`mcp`, `query`, `explain`, `SKILL_memory.md`, docs/QA, screenshots, validate`), and not every inspector is accepted.
- Commit not created: owner handoff remains blocked.

### Round 18 review

- Accepted builder change: `packages/memory/src/cache.cli.ts` landed with `runMemoryCacheStatus()` and `runMemoryCacheClear({ root, olderThan, yes })`, colocated tests were added in `packages/memory/src/cache.cli.test.ts`, package exports were updated, and the builder reported targeted package tests for `cache.cli.test.ts` and `index.test.ts` passing.
- Updated Task Board: `Cache CLI: cache status, cache clear --older-than <d> --yes` is now checked.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary, not scoped validation of the cache CLI change; non-blocking feedback only.
  - `testing`: did not verify this round's change and explicitly asked for missing prior context, so it is not accepted.
  - `poe-agent-improver`: still flags an unresolved systemic issue — shell/file-tool overlap guardrails remain open on the Task Board.
  - `superintendent-improver`: still flags unresolved systemic observability/tooling issues and is not accepted.
- Rejected for owner handoff this round: multiple Task Board items remain open (`ingest`, `lint`, systemic poe-agent guardrails, MCP, query/explain, skill template, docs/QA, screenshots, validate`), and inspectors are not all accepted.
- Commit not created: owner handoff is blocked.

### Round 17 review

- Accepted builder change: `packages/memory/src/install.ts` landed with `installMemory(...)`, package exports were updated, colocated tests were added in `packages/memory/src/install.test.ts`, and the builder reported targeted package tests plus package build passing.
- Updated Task Board: `Implement src/install.ts + install.cli.ts` is now checked.
- Rejected inspector acceptance this round:
  - `code-quality`: still broad repo-level architecture commentary, not scoped validation of the memory install change; non-blocking feedback only.
  - `testing`: useful overall verification that the full test suite passes and new memory modules have colocated tests, but it still flags an open gap: `packages/memory/src/types.ts` lacks its own colocated `types.test.ts`.
  - `poe-agent-improver`: flagged an unresolved systemic issue — shell/file-tool overlap still causes inefficient shell-based reads in replay and needs the planned guardrail task completed.
  - `superintendent-improver`: flagged unresolved systemic logging/DX issues (`replay` UX, missing handover/MCP observability, misleading usage accounting); still not accepted.
- Rejected for owner handoff this round: multiple Task Board items remain open (`ingest`, `lint`, cache CLI, systemic poe-agent guardrails, MCP, query/explain, skill template, docs/QA, screenshots, validate`), and inspectors are not all accepted.
- Commit not created: owner handoff is blocked.

### Round 11 review

- Accepted builder change: `src/write.ts` now implements `writePage` and `appendToPage`, exports both from the package barrel, and the builder reports package tests/build passing; corresponding Task Board item remains checked.
- Rejected for owner handoff this round: Task Board still has many open items starting with `src/cache.ts`.
- Rejected inspector acceptance this round:
  - `code-quality`: still unrelated broad architecture/spec feedback, not validation of this scoped memory package change.
  - `testing`: still could not access or run the actual workspace/package, so it did not verify the claimed test/build runs.
  - `poe-agent-improver`: flagged an unresolved systemic issue — builder still preferred shell `exec` over structured file tools, degrading auditability.
  - `superintendent-improver`: concurred that the shell-vs-typed-tools issue remains a systemic problem.
- Handoff remains blocked until every Task Board item is checked and inspector concerns are either resolved in code/process or replaced with passing inspector runs.

### Round 10 review

- Accepted builder change: `auditClaims` now checks stale/missing `extracted` refs, low-confidence `inferred` claims, malformed confidence tags, long untagged pages when `rejectUntagged` is enabled, and frontmatter `sources:` drift; audit task remains checked.
- Rejected for owner handoff this round: Task Board still has many open items.
- Rejected inspector acceptance this round:
  - `code-quality`: still unrelated broad architecture/spec feedback, not validation of this scoped memory package change.
  - `testing`: still could not access or run the actual workspace/package, so it did not verify the claimed test/build runs.
  - `poe-agent-improver`: flagged an unresolved systemic issue — builder continues preferring shell over structured file tools.
  - `superintendent-improver`: flagged unresolved systemic issues — dirty/uncommitted builder output, replay schema observability gaps, and incomplete inspector logging.
- Handoff remains blocked until every Task Board item is checked and inspector concerns are either resolved in code/process or replaced with passing inspector runs.

### Round 8 review

- Accepted builder change: `src/confidence.ts` and tests landed; task remains checked.
- Rejected for owner handoff this round: Task Board still has many open items.
- Rejected inspector acceptance this round:
  - `code-quality`: unrelated broad repo-doc review, not a useful signal on this scoped memory task.
  - `testing`: could not access the actual repo/package, so it did not verify the claimed test/build runs.
  - `poe-agent-improver`: flagged a real systemic issue — poe-agent runs are missing spawn logs, so replay inspected unrelated logs.
  - `superintendent-improver`: flagged a real systemic issue — replay path template variables resolved to empty strings.
- Handoff blocked until open tasks are completed and the two meta-inspector systemic issues are addressed/accepted elsewhere.
