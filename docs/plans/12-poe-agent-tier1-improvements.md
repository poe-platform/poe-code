# poe-agent Tier 1 improvements

Adopt three load-bearing strengths from pi-mono's coding-agent: typed hook decision contracts, a tree-shaped session model, and file-awareness through compaction.

## 1. Problem

`@poe-code/poe-agent` covers the same ground as pi-mono's `coding-agent` in terms of tools, plugins, policy, and MCP — but three architectural choices in pi-mono are doing real work for it that we cannot reproduce today:

1. **Hook decisions are too weak.** Our `HookDecision` is `"skip" | "abort" | { reject: string } | void`. A plugin can allow or deny, but cannot **rewrite** a tool call, **replace** a tool result before the model sees it, **redact** user input, or **take over** a turn. Every non-trivial extension (sandboxed backends, redaction, policy extensions, tool-result caching) is blocked on this.
2. **Sessions are flat and in-memory.** `agent-session.ts` keeps a single `ChatMessage[]` in a closure. We expose `fork()` on `IterationContext` but with no `parentId`, no entry IDs, no branch summaries, no durable store. Resume works only as "reuse the previous RunResult in the same process" — nothing survives a restart, nothing can be navigated.
3. **Compaction forgets what files the agent touched.** `compactionPlugin` summarizes dropped messages as free text. Which files were read or modified lives only inside that text — post-compaction the agent has to rediscover file awareness by re-reading, and tool-policy plugins lose the "this file was already inspected" signal.

Evidence these are worth solving now:

- The discovery plan at [docs/plans/pi-mono-coding-agent-integration.md](docs/plans/pi-mono-coding-agent-integration.md) identified these exact three as the load-bearing strengths of pi-mono.
- The Tier 2/3 items (Operations backends, wire-level provider hooks, mutation queue, RPC mode) all depend on at least one of these three. Shipping them first unblocks the rest.

### Out of scope

- Tier 2/3 items: `*Operations` backends, `before/after_provider_request`, file-mutation queue, RPC JSONL mode, skills frontmatter/merge, model registry, TUI widgets.
- Changing MCP surface, policy model, or provider implementations.
- Replacing `@poe-code/agent-spawn`'s own session concept (poe-agent sits on top of it).
- Writing the pi-mono integration itself — this plan only hardens the poe-agent substrate.

## 2. User-facing shape

This package is a TypeScript SDK. The "user" here is a plugin author and a caller of `createAgentSession`.

### 2.1 Typed hook decisions

New discriminated unions replace the existing `HookDecision`:

```ts
// Returned from preToolUse
type ToolCallDecision =
  | void
  | "skip"
  | "abort"
  | { block: true; reason: string }         // reject with structured reason
  | { rewrite: { args: unknown } };         // change args before the tool runs

// Returned from postToolUse
type ToolResultDecision =
  | void
  | "abort"
  | { replace: { content?: unknown; details?: unknown; isError?: boolean } };

// Returned from userPromptSubmit
type InputDecision =
  | void
  | "abort"
  | { action: "transform"; prompt: string }   // replace the user prompt
  | { action: "handled"; response: string };  // take over the turn, return response to user
```

Every other hook keeps `HookDecision = "skip" | "abort" | void`. The old `{ reject: string }` shape is removed — callers migrate to `{ block: true, reason }` in the same release.

Example plugin:

```ts
const redactor: AgentPlugin = {
  name: "redactor",
  hooks: {
    preToolUse(ctx) {
      if (ctx.tool !== "bash") return;
      const args = ctx.args as { command: string };
      if (args.command.includes("AWS_SECRET")) {
        return { block: true, reason: "Command contained a secret marker." };
      }
      return { rewrite: { args: { ...args, command: scrub(args.command) } } };
    },
    postToolUse(ctx) {
      if (ctx.tool !== "read_file") return;
      return { replace: { content: scrubSecrets(ctx.result) } };
    }
  }
};
```

### 2.2 Tree-shaped session model

A session is a tree of typed entries, append-only. Every entry has `id` and `parentId`.

```ts
type SessionEntry =
  | { kind: "user";            id: string; parentId: string | null; createdAt: string; text: string }
  | { kind: "assistant";       id: string; parentId: string | null; createdAt: string; text: string }
  | { kind: "tool_call";       id: string; parentId: string | null; createdAt: string; tool: string; args: unknown; intentId: string }
  | { kind: "tool_result";     id: string; parentId: string | null; createdAt: string; intentId: string; result?: unknown; error?: string }
  | { kind: "compaction";      id: string; parentId: string | null; createdAt: string; summary: string; droppedIds: string[]; readFiles: string[]; modifiedFiles: string[] }
  | { kind: "branch_summary";  id: string; parentId: string | null; createdAt: string; fromEntryId: string; summary: string }
  | { kind: "fork_marker";     id: string; parentId: string | null; createdAt: string; fromEntryId: string };
```

New API on `AgentSession`:

```ts
interface AgentSession {
  sendMessage(prompt: string, options?: AgentSessionSendMessageOptions): Promise<ChatMessage>;
  tree(): SessionEntry[];                       // full session history, ordered
  fork(fromEntryId: string): Promise<AgentSession>;   // branch a new session from an entry
  navigateTo(entryId: string): Promise<void>;   // rewind the active head to an earlier entry
  dispose(): Promise<void>;
}
```

`createAgentSession` gains an opt-in persistence option:

```ts
createAgentSession({
  model: "claude-sonnet-4-6",
  persist: { directory: "~/.poe-code/sessions" }  // opt-in; omit to stay in-memory only
});
```

When enabled, each entry is appended to `<directory>/<sessionId>.jsonl` as one JSON object per line.

### 2.3 File awareness through compaction

`PreCompactionContext`, `PostCompactionContext`, and `IterationContext` gain two new fields:

```ts
type FileAwareness = {
  readFiles: ReadonlySet<string>;       // absolute paths
  modifiedFiles: ReadonlySet<string>;   // absolute paths
};

type IterationContext = { /* existing */ } & FileAwareness;
type PreCompactionContext = { /* existing */ } & FileAwareness;
type PostCompactionContext = { /* existing */ } & FileAwareness;
```

The default summariser is extended to render these lists into the summary so the model retains awareness, and the sets persist across compaction (they belong to the session, not the message window).

A custom `summarise(messages, awareness)` callback signature is added:

```ts
type CompactSummarise = (
  messages: ChatMessage[],
  awareness: FileAwareness
) => string | Promise<string>;
```

## 3. Implementation details and technical decisions

### 3.1 Hook decisions

- Two new context fields on `ToolUseContext` — none needed; the existing `args`, `result`, `error` fields are mutable enough. We express rewrite/replace as decision payloads, not context mutation, so the runner — not the plugin — performs the mutation.
- Ordering when multiple plugins return decisions on the same event: **first non-void wins**. This is already the behaviour in `runHookPipeline`. Document it.
- Legacy `{ reject: string }` on `preToolUse`: detected in `applyHookDecision`, emits a one-time `console.warn` via the existing logging channel, mapped to `{ block: true, reason: decision.reject }`. No behaviour change, one release of runway.
- `rewrite` applies before the tool is executed. `replace` applies after `postToolUse` returns, before the tool result is pushed onto `messages`.
- `{ action: "handled" }` on `userPromptSubmit` short-circuits the iteration: the response string is appended as an assistant message and the iteration loop completes without calling the model.
- Edge case: two plugins both return `rewrite` for the same tool call. Policy: first wins; later rewrites are ignored. Log at debug.
- Edge case: `rewrite` returns invalid args that the tool's JSON schema rejects. Policy: surface as a normal tool validation error back to the model; do not crash the loop.

### 3.2 Tree-shaped session model

- New module: `packages/poe-agent/src/runtime/session/`.
- Entry IDs: ULIDs (sortable, monotonic-ish). Use `crypto.randomUUID()` for simplicity if ULID adds a dep — confirm at code-plan time.
- `parentId` = the previous entry's id on the current branch, or `null` for the root.
- Append-only store: `SessionStore` interface with one impl `JsonlSessionStore`. In-memory default is `MemorySessionStore` which implements the same interface but never writes to disk. The session always goes through a store — never skips it — so `tree()` is always answerable.
- `fork(fromEntryId)`: creates a new `sessionId`, copies entries from root through `fromEntryId` into the new session (copy-on-write not worth the complexity at this stage), writes a `fork_marker` entry referencing the source, writes a `branch_summary` entry into the **source** session marking the pruned branch below `fromEntryId` (so the tree of the parent still shows where divergence happened).
- `navigateTo(entryId)`: sets the "head" pointer of the session to `entryId`. New entries' `parentId` becomes `entryId`. Entries between the old head and `entryId` are **not** deleted (append-only) — they stay visible in `tree()` as a dead branch. On the next model call we rebuild `ChatMessage[]` from root to the current head.
- Reconstruction: `buildMessages(entries, headId)` walks parents from head to root, reverses, filters to renderable entries (`user`, `assistant`, `tool_call`+`tool_result` pairs, `compaction.summary`). Pure function. Tested in isolation.
- Persistence location: opt-in via `persist.directory`. No default filesystem writes. Rationale: CLAUDE.md's "explicit over implicit" — we don't silently write sessions to disk.
- Session id: opaque string, generated at `createAgentSession` time. Also returned on a new `session.id` property.
- Concurrency: one writer per session. The JSONL store holds an open file handle and appends synchronously (serialised through a simple async queue). Crash-safety comes from `fs.appendFile` semantics.
- We **do not** try to pipe this through `@poe-code/agent-spawn`'s internal session handling. agent-spawn keeps doing its job (running the tool loop); poe-agent mirrors each turn's events into the `SessionStore` at the poe-agent layer. `agent-session.ts`'s `for await (const event of acpSession.events)` loop is the natural place to record entries.

#### Open questions (session tree)

- Open question: do we want `tree()` to return raw entries or a structured tree with children arrays? Entries with `parentId` is enough to reconstruct either; start with the flat list and add a helper if needed.
- Open question: should `fork()` physically copy entries, or store a `copyFrom` pointer? Start with physical copy for simplicity — forks are rare.
- Open question: how do we garbage-collect dead branches in the JSONL file? Not in this plan. Note it as a known gap.

### 3.3 File awareness through compaction

- New module: `packages/poe-agent/src/runtime/file-awareness.ts`.
- A `FileAwarenessTracker` is constructed per session. It exposes `recordRead(path)`, `recordWrite(path)`, `readFiles()`, `modifiedFiles()`.
- Hook into the existing `postToolUse` pipeline with an internal plugin (not a hook decision — the runner calls it directly after user plugins). The internal plugin inspects tool name and args/result:
  - `read_file` → `recordRead(args.path)`
  - `write_file` → `recordWrite(args.path)`
  - `edit` (when we add it) → `recordWrite(args.path)`
  - Everything else → ignored.
- Paths are normalised to absolute (resolved against session cwd) before being stored. No regexes — use `path.resolve`.
- The tracker survives compaction — compaction only touches `ctx.messages`, not the tracker.
- The default summariser prompt is extended to render the file lists inline. The custom `summarise` callback now receives a second `awareness` argument; existing single-argument callbacks keep working via arity check (`fn.length === 1`).
- On `compaction` entry persistence (3.2), `readFiles` and `modifiedFiles` snapshots are stored on the entry so a resumed session can rebuild awareness without replaying.

#### Open questions (file awareness)

- Open question: should we also track a `deletedFiles` set? Not today — no delete tool exists in the builtins. Add when needed.
- Open question: should we expose the tracker on `PluginApi` so plugins can consult it? Yes in a follow-up; not required for Tier 1.

### 3.4 Breaking-change strategy

- Hook decision shapes: backward-compatible for one minor release (legacy `{ reject }` accepted with a warning). After that, remove the legacy branch.
- Session API additions (`tree`, `fork`, `navigateTo`, `id`, `persist`): purely additive. Existing callers unaffected.
- Compaction context additions (`readFiles`, `modifiedFiles`): additive. Existing plugins that ignore the fields keep working.
- Custom `summarise` signature: arity-dispatched, both old and new shapes work.

### 3.5 Config knobs introduced

| Knob | Default | Scope |
| --- | --- | --- |
| `persist.directory` | unset (in-memory) | `createAgentSession` option |
| — | — | No new env vars |
| — | — | No new CLI flags at the poe-agent layer |

## 4. Interfaces and test plan

### 4.1 Module boundaries

- `runtime/plugin-types.ts` — new decision unions, extended hook context types. Single source of truth for public plugin contracts.
- `runtime/hooks.ts` — `applyHookDecision` extended for the new shapes; decision application moved into dedicated per-event helpers to keep it testable.
- `runtime/session/entry-types.ts` — `SessionEntry` union + type guards (plain TS, no zod).
- `runtime/session/session-store.ts` — `SessionStore` interface, `MemorySessionStore`, `JsonlSessionStore`.
- `runtime/session/session-tree.ts` — `buildMessages`, `findHead`, `collectBranch`.
- `runtime/file-awareness.ts` — `FileAwarenessTracker` + the internal post-tool-use recorder.
- `agent-session.ts` — wires tracker + store into the ACP event loop and exposes `tree()` / `fork()` / `navigateTo()` / `id`.
- `plugins/poe-agent-plugin-compaction.ts` — consumes `FileAwareness`, updates summariser prompt and `CompactSummarise` signature.

### 4.2 Signatures that cross boundaries

```ts
// runtime/session/session-store.ts
interface SessionStore {
  readonly sessionId: string;
  append(entry: SessionEntry): Promise<void>;
  list(): Promise<SessionEntry[]>;
  dispose(): Promise<void>;
}

function createMemorySessionStore(sessionId: string): SessionStore;
function createJsonlSessionStore(sessionId: string, directory: string): Promise<SessionStore>;

// runtime/session/session-tree.ts
function buildMessages(entries: SessionEntry[], headId: string | null): ChatMessage[];
function findHead(entries: SessionEntry[]): string | null;
function collectBranch(entries: SessionEntry[], headId: string): SessionEntry[];

// runtime/file-awareness.ts
interface FileAwarenessTracker {
  recordRead(path: string): void;
  recordWrite(path: string): void;
  snapshot(): FileAwareness;
}
function createFileAwarenessTracker(cwd: string): FileAwarenessTracker;

// runtime/hooks.ts (new)
function applyToolCallDecision(decision: ToolCallDecision, ctx: ToolUseContext): ToolCallOutcome;
function applyToolResultDecision(decision: ToolResultDecision, ctx: ToolUseContext): ToolResultOutcome;
function applyInputDecision(decision: InputDecision, ctx: UserPromptSubmitContext): InputOutcome;
```

### 4.3 Test plan

TDD order — write tests first, fail, then implement. All unit tests use `memfs` for filesystem, no real I/O.

#### Hook decisions

- Unit: `applyToolCallDecision` — void, skip, abort, `{ block }`, `{ rewrite }`, legacy `{ reject }` with warning, two plugins each returning rewrite (first wins).
- Unit: `applyToolResultDecision` — void, abort, `{ replace }` partial (content only, error only, both).
- Unit: `applyInputDecision` — void, abort, `{ action: "transform" }`, `{ action: "handled" }` (short-circuits iteration).
- Integration: plugin that rewrites bash args sees its rewrite in the spawned tool call.
- Integration: plugin that replaces a read_file result sees the replaced content in the next model message.
- Integration: legacy plugin returning `{ reject: "no" }` still blocks the tool and logs a warning exactly once per process.

#### Session tree

- Unit: `buildMessages` reconstructs a linear conversation.
- Unit: `buildMessages` follows `parentId` through a forked branch and ignores siblings on dead branches.
- Unit: `JsonlSessionStore.append` writes one line per entry, `list()` replays in order, roundtrip is lossless.
- Unit: `JsonlSessionStore` survives process crash mid-write (simulate partial line; last line is discarded).
- Integration: `createAgentSession` without `persist` keeps working (memory store); with `persist` creates the file and replays on a subsequent `createAgentSession({ resumeSessionId })` (cross-reference: if we don't support resume yet, document it as a next-step and gate the test on that feature).
- Integration: `fork(entryId)` creates a new session whose `tree()` ends at `entryId` and whose `sendMessage` appends onto that branch.
- Integration: `navigateTo(entryId)` rewinds head; a subsequent `sendMessage` parents onto `entryId` and the old branch is still visible in `tree()` but not in `ChatMessage[]` passed to the model.

#### File awareness

- Unit: `FileAwarenessTracker.recordRead` / `recordWrite` dedupe and normalise paths to absolute.
- Unit: tracker ignores unknown tools.
- Unit: compaction summariser prompt includes readFiles/modifiedFiles when non-empty, omits when empty.
- Unit: custom `summarise(msgs)` (arity 1) still called with messages only; custom `summarise(msgs, awareness)` (arity 2) receives awareness.
- Integration: run read_file → compaction → next iteration — `PostCompactionContext.readFiles` contains the original path.
- Integration: compaction entry persisted by `JsonlSessionStore` carries the file lists and roundtrips.

#### Manual QA (markdown, per CLAUDE.md)

Add `docs/qa/poe-agent-tier1.md` with step-by-step manual checks:

1. Run `npm run dev -- chat` with a `persist.directory`, observe the JSONL file, stop the process, restart, see entries replay.
2. Register a plugin that rewrites tool args; confirm observable effect in logs.
3. Trigger compaction manually; confirm the summary message mentions the files read and modified.

### 4.4 Rollout / migration

- One commit per numbered item, in this order: (1) typed hook decisions, (2) session tree, (3) file awareness. Each step ships independently and keeps the package green.
- No published downstream consumer needs to change code. The legacy `{ reject }` shape stays accepted in release N; a follow-up release N+1 removes it. Changelog entry in each release.
- No beta gating required — all changes are additive to the public API.

## 5. Code plan

### 5.1 Ordering

Build in dependency order so `main` stays green after each step:

1. **Step A — Typed hook decisions.** Smallest, zero data-layer churn, unlocks decision richness that tests for later steps can lean on.
2. **Step B — Tree-shaped session model.** Larger, introduces `runtime/session/`, wires store into `agent-session.ts`. Does not depend on Step A's new semantics.
3. **Step C — File awareness through compaction.** Depends on Step B's session entries to persist the `readFiles` / `modifiedFiles` snapshot on compaction entries; depends on Step A for the `replace` decision shape only if we want a "scrub on read" example plugin.

### 5.2 Step A — Typed hook decisions

New files: _(none)_

Modified files:

- `packages/poe-agent/src/runtime/plugin-types.ts`
  - Add `ToolCallDecision`, `ToolResultDecision`, `InputDecision` unions.
  - Narrow `AgentPlugin.hooks.preToolUse` return type to `ToolCallDecision | Promise<ToolCallDecision>` (still accepts legacy `{ reject }` for one release via `ToolCallDecisionLegacy` alias).
  - Narrow `postToolUse` to `ToolResultDecision`, `userPromptSubmit` to `InputDecision`.
  - Keep other hooks on `HookDecision`.
- `packages/poe-agent/src/runtime/hooks.ts`
  - Split `applyHookDecision` into `applyToolCallDecision`, `applyToolResultDecision`, `applyInputDecision`, and a residual for the unchanged events.
  - `HookDispatchResult` gains `{ type: "rewrite"; args: unknown }`, `{ type: "replace"; patch: Partial<…> }`, `{ type: "handled"; response: string }`.
  - Legacy `{ reject }` detector issues a one-time warning (use a module-level `Set<string>` keyed by plugin name if we have it, else global).
- `packages/poe-agent/src/runtime/iteration-loop.ts` (or wherever `dispatchHook('preToolUse')` is consumed — audit at implementation time)
  - Act on `rewrite` by swapping the tool call's args before execution.
  - Act on `replace` by mutating the tool-result record before it is pushed onto `messages`.
  - Act on `handled` by appending the response as an assistant message and breaking out of the iteration.

Test files added / extended:

- `packages/poe-agent/src/runtime/hooks.test.ts` — all unit cases listed in §4.3.
- `packages/poe-agent/src/runtime/iteration-decisions.test.ts` — new, integration-ish, using a fake model + fake tool to verify end-to-end decision application.

### 5.3 Step B — Tree-shaped session model

New files:

- `packages/poe-agent/src/runtime/session/entry-types.ts` — `SessionEntry` union + `isUserEntry` / `isAssistantEntry` / … type guards.
- `packages/poe-agent/src/runtime/session/session-store.ts` — `SessionStore` interface, `createMemorySessionStore`, `createJsonlSessionStore`.
- `packages/poe-agent/src/runtime/session/session-tree.ts` — `buildMessages`, `findHead`, `collectBranch`.
- `packages/poe-agent/src/runtime/session/session-store.test.ts`
- `packages/poe-agent/src/runtime/session/session-tree.test.ts`

Modified files:

- `packages/poe-agent/src/agent-session.ts`
  - `createAgentSession` constructs a `SessionStore` based on `options.persist`.
  - `adaptAcpToLegacySession` records entries as ACP events flow through (`message.delta` → assistant entry at turn end; `tool.intent` → `tool_call`; `tool.result` → `tool_result`).
  - Adds `tree()`, `fork(fromEntryId)`, `navigateTo(entryId)`, `id`.
  - The next `sendMessage` rebuilds `ChatMessage[]` via `buildMessages(entries, headId)` and feeds that as the resume context instead of `previousRun`.
- `packages/poe-agent/src/index.ts` — export `SessionEntry` and the new session methods' types.

Non-obvious call-outs at implementation time:

- The current `previousRun: RunResult | undefined` trick in `adaptAcpToLegacySession` ([packages/poe-agent/src/agent-session.ts:123](packages/poe-agent/src/agent-session.ts#L123)) becomes a fallback when there's no store; with a store, resume context is derived from the tree. Keep both paths during the migration.
- `SessionUpdateCallback` is unaffected — entries are recorded alongside, not instead of, the event stream.

### 5.4 Step C — File awareness through compaction

New files:

- `packages/poe-agent/src/runtime/file-awareness.ts` — `FileAwarenessTracker` + `createFileAwarenessTracker`.
- `packages/poe-agent/src/runtime/file-awareness.test.ts`.

Modified files:

- `packages/poe-agent/src/runtime/plugin-types.ts`
  - `IterationContext`, `PreCompactionContext`, `PostCompactionContext` extended with `readFiles: ReadonlySet<string>` and `modifiedFiles: ReadonlySet<string>`.
  - `IterationCompactionOptions.summarise` signature widened to accept optional second arg.
- `packages/poe-agent/src/runtime/hooks.ts`
  - `createPreCompactionHookContext` / `createPostCompactionHookContext` / `createPreIterationHookContext` / `createPostIterationHookContext` take the tracker snapshot and inject the two fields.
- `packages/poe-agent/src/agent-session.ts`
  - Creates a `FileAwarenessTracker` per session; passes it into the iteration loop.
  - On `tool.result` events for `read_file` / `write_file` / `edit`, calls `recordRead` / `recordWrite`.
- `packages/poe-agent/src/plugins/poe-agent-plugin-compaction.ts`
  - `summariseWithModel` prompt includes rendered file lists when non-empty.
  - `resolveCompactionSummary` detects custom summarise arity (`fn.length`) and calls accordingly.
  - On `compaction` session entry creation (wired into Step B), include `readFiles` + `modifiedFiles` snapshot.

Test files added / extended:

- `packages/poe-agent/src/runtime/file-awareness.test.ts` — unit cases.
- `packages/poe-agent/src/plugins/poe-agent-plugin-compaction.test.ts` — extended with awareness cases and arity dispatch.

### 5.5 Docs touched

- README sections for `createAgentSession` (add `persist`, `tree`, `fork`, `navigateTo`). **Do not touch README without the user's permission** (CLAUDE.md rule). Flag this in chat and wait for approval.
- `docs/qa/poe-agent-tier1.md` — new manual QA script (markdown, not TS).
- `docs/plans/pi-mono-coding-agent-integration.md` — add a line under "Cross-check" pointing to this plan so the discovery knows Tier 1 is planned.
