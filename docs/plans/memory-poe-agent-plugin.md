# Memory as a poe-agent plugin

Revive `@poe-code/memory` by making it the memory of the `@poe-code/poe-agent` runtime. One plugin, layered: the always-on bulletin is the core; digest/recall and learning are opt-in. The default config is the simplest possible memory. Core constraint throughout: extremely concise — small, high-signal context, never a dump.

## Principles (validated against pi, Claude Code, mem0, Letta, Zep, Windsurf/Cursor, ChatGPT)

- Repo-visible plain files, never shadow state — committable, PR-reviewable, editable by hand. (Loudest complaint against Claude Code auto-memory; pi's core stance.)
- LLM-free read path: LLM cost only at write/distill time; reads are ranked search over files. (Zep; a plain grep agent beats every vector-store memory on LOCOMO.)
- Learned entries are dated, declarative facts with provenance — never instructions. Blunts memory poisoning (SpAIware-class) and enables staleness handling, the #1 reason users disable auto-memory.
- Hard budgets with agent-visible overflow, never silent truncation. (Claude Code's 200-line silent cutoff loses facts; Letta surfaces overflow errors to the agent.)

## Index-card discipline (every write path)

- An entry reads like an index card: one dense, concrete line — no narrative, no hedging, no context the repo already provides.
- Only two things qualify: explicit user input (corrections, preferences, decisions) and hard-won learnings — facts that cost real effort to discover (long debugging, failed attempts, non-obvious constraints). The selection test: would rediscovering this take significant time? If it's one grep away, it doesn't qualify.
- Enforced where writing happens: `memory_add`/`memory_append` tool descriptions state this bar, the distill prompt ranks candidates by cost-to-rediscover, and `memory lint` flags verbose or narrative entries.

## Decisions

- Single registry key `memory` backs onto `@poe-code/memory` (pages at `.poe-code/memory/`, `openMemory` handle API). poe-agent gets a workspace dep on `@poe-code/memory`. No separate memory-simple plugin — simple is the default layer of this one.
- The current AGENTS.md loader is renamed: registry key `agents-md`, file `poe-agent-plugin-agents-md.ts`. Breaking registry-key change, acceptable pre-1.0.
- No MCP hop (`@modelcontextprotocol/sdk` stays dev-only): native tools reusing the same operations as `mcp.ts`.

## Layer 1 — Bulletin (always on)

- One fixed page `bulletin.md`, one fact per `- ` bullet line, injected whole as a "Memory bulletin" section every iteration, so mid-session edits appear on the next iteration.
- Hard cap `bulletinTokens` (default 300, counted via existing `tokens.ts`): a write that would exceed it fails with an agent-visible error stating current/max size — distill or remove first.
- Tools: `memory_add(fact)` (rejects multi-line/oversized; exact duplicate → noop), `memory_remove(fact)` (removal recorded in LOG.md), `memory_get()`.
- The agent never reads memory files directly — tools are its only interface; humans edit the markdown by hand.

## Layer 2 — Digest + recall (`digest: true`)

- `prompt(ctx)` adds a digest below the bulletin: INDEX entries ranked by confidence × recency, hard-capped at `budgetTokens` (default 500). Over budget → drop lowest-ranked entries whole, never truncate mid-entry; ends with an explicit `+N omitted — memory_search` line.
- `userPromptSubmit` runs `searchMemory` on the prompt and injects top hits, sharing the same budget. Full pages only via tools, on demand.
- Adds tools `memory_search`, `memory_read`, and `memory_append` only when `writes: true`; page writes above a per-entry token cap are refused with a "distill it" error.

## Layer 3 — Learning (`learn: true`)

- `stop` hook distills the session into at most 3 one-line dated facts, deduped against `searchMemory` hits, appended through the budgeted write path.
- Contradictions go through `reconcile` — soft invalidation (Zep-style): the losing entry moves to `LOG.md` with its dates; pages hold only currently-true facts. History auditable, pages lean.
- Ranking decays stale facts; entries past a staleness threshold leave the digest (still searchable).

## Plugin shape

Rewrite `packages/poe-agent/src/plugins/poe-agent-plugin-memory.ts`:

- options `{ root?, bulletinTokens?, digest?, budgetTokens?, writes?, learn? }` parsed by the registry spec; CLI wiring maps resolved `memory.*` config (`packages/poe-code-config/src/memory.ts`) onto these options — the plugin itself stays config-unaware
- `hooks.stop`: distill when learn; `dispose()`: close handle
- exported from `packages/poe-agent/src/index.ts` and usable via `agent().use(memoryPlugin(...))` — CLI and SDK take identical options

## Memory quality

- Recall eval: a fixture repo with seeded pages + prompts, snapshot-asserting the digest under budget. Cases must include knowledge-update (newer fact wins over its contradicted ancestor) and abstention (no relevant memory → nothing injected) — the two categories where memory systems actually fail; don't chase LOCOMO-style recall.

## Revive

- Unhide `memory` in root `--help` (docs/issues/ux-root-help-hides-skill-memory-runtime-eval-and-more.md).
- New CLI subcommands: `memory digest` prints exactly what the plugin would inject (Codex `--print-instructions` pattern); `memory promote <path>` moves a proven learned fact into AGENTS.md (Windsurf's memory→rule promotion, closing the loop with the `agents-md` plugin).

## Tests

- TDD; memfs for all fs; distillation via the agent mock + snapshot testing (docs/SNAPSHOT_TESTING.md).
- Units: bulletin injection + mid-session refresh + cap error + add/remove/get round-trip + duplicate-add noop, digest ranking/budget cap + overflow line, staleness decay, per-prompt recall injection, write-cap rejection, dedupe-before-append, soft invalidation to LOG.md, spec option parsing, `agents-md` rename.
- Update `packages/poe-agent/README.md` and `packages/memory/README.md` (options, env vars).
