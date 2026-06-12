---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Poe Agent resume support

Let `poe-code spawn --agent poe-agent --resume-thread-id <id>` continue a prior poe-agent session with its conversation context, like the other seven providers.

## 1. What we're building

Resume support for the poe-agent provider: a poe-agent run returns a threadId; passing that threadId via the existing `--resume-thread-id` flag (or `resumeThreadId` SDK option) continues the conversation with full prior history. History is persisted as full `ChatMessage[]` on disk (lossless, the exact shape `injectResumeMessages` consumes) — not reconstructed from transcripts or run reports.

Non-goals:

- No interactive-mode resume (poe-agent has no interactive TUI).
- No change to the resume UX of the other providers.
- No session listing/GC commands (`poe-code sessions ...`) — files just accumulate under `~/.poe-code/sessions/`.

## 2. User-facing shape

First run — threadId is surfaced and a copy-paste resume hint is printed:

```
$ poe-code spawn --agent poe-agent "add a coverage badge to the README"
...streamed run output...

Resume: poe-code spawn --agent poe-agent --resume-thread-id poe-agent-9f1c4e2a-…
```

Resumed run — the agent sees the prior conversation:

```
$ poe-code spawn --agent poe-agent --resume-thread-id poe-agent-9f1c4e2a-… "now do the same for CONTRIBUTING.md"
```

JSON output mode: unchanged — `spawn_result` already carries `threadId`; resuming reuses the same `threadId` in `session_start` and `spawn_result`.

Standalone binary parity:

```
$ poe-agent --resume-thread-id poe-agent-9f1c4e2a-… "continue"
```

SDK parity (already typed, currently ignored by poe-agent):

```ts
await sdk.spawn({ agent: "poe-agent", prompt: "continue", resumeThreadId: "poe-agent-9f1c4e2a-…" });
```

Errors:

```
$ poe-code spawn --agent poe-agent --resume-thread-id nope "hi"
Error: Unknown poe-agent thread "nope". Sessions are stored in ~/.poe-code/sessions.
```

Model precedence on resume: explicit `--model` > model stored in the session > `DEFAULT_FRONTIER_MODEL`.

## 3. Implementation details and technical decisions

Architecture:

- **Persistence lives in `packages/poe-agent`** (new `session-store.ts`): it owns the runtime `ChatMessage` type being serialized. One JSON file per thread at `~/.poe-code/sessions/<threadId>.json` (follows the `~/.poe-code/reports/`, `~/.poe-code/spawn-logs/` convention). `homeDir` is injectable, fs is injectable for memfs tests.
- **The runtime already resumes from messages**: `AgentRunOptions.resume` is only read as `options.resume?.messages` (`injectResumeMessages`, [agent.ts:375](../../packages/poe-agent/src/agent.ts)). Widen its type from `RunResult` to `Pick<RunResult, "messages">` and seed `previousRun` in `adaptAcpToLegacySession` from a new `CreateAgentSessionOptions.resume` option. Add `getHistory()` to `AgentSession` so callers can read messages back out after a run.
- **Provider plumbing** ([src/providers/poe-agent.ts](../../src/providers/poe-agent.ts)): `spawnPoeAgentWithAcp` and `PoeAgentLifecycleOptions` accept `resumeThreadId`. The lifecycle loads the persisted session up front (so it can apply model precedence), passes `{ threadId, messages }` into the in-memory transport; `session/new` seeds `createAgentSession` with the restored messages and reuses the threadId as sessionId. After `session/prompt` completes, the transport saves `session.getHistory()` back to the store.
- **ThreadId uniqueness**: replace the `poe-agent-session-${counter}` ids with `poe-agent-${randomUUID()}` — counter ids collide across processes, which breaks file-per-thread storage.
- **Resume hint**: the shared hint composer in [shared.ts](../../src/cli/commands/shared.ts) only works for `kind: "cli"` spawn configs with a `binaryName`; poe-agent is in-process. The poe-agent spawn handler prints its own hint line (`Resume: poe-code spawn --agent poe-agent --resume-thread-id <id>`) — this is inside the provider's own handler module, so no cross-provider branching.

Edge cases:

- Unknown threadId → fail with the error above; never silently start a fresh session.
- Corrupt JSON or unsupported `version` in the session file → fail with the file path in the message.
- Resume + multiple prompts in one process (in-memory `sessions` map) keeps working; the file is rewritten after each completed prompt.
- `--dry-run` with `--resume-thread-id` does not touch the store.
- Failed runs (`stopReason !== "completed"` or thrown error) do not overwrite the stored history.

Flags / env / config: no new flags, no new env vars, no new config keys. `--resume-thread-id` and `resumeThreadId` already exist; the sessions directory derives from the existing `homeDir` resolution.

## 4. Interfaces and test plan

New module `packages/poe-agent/src/session-store.ts`:

```ts
export interface PersistedAgentSession {
  version: 1;
  threadId: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface AgentSessionStore {
  load(threadId: string): Promise<PersistedAgentSession | undefined>;
  save(session: PersistedAgentSession): Promise<void>;
}

export function createAgentSessionStore(options?: {
  homeDir?: string;
  fs?: Pick<FileSystem, "mkdir" | "readFile" | "writeFile">;
}): AgentSessionStore;
```

Changed contracts:

```ts
// packages/poe-agent/src/agent.ts
export interface AgentRunOptions { resume?: Pick<RunResult, "messages">; /* … */ }

// packages/poe-agent/src/agent-session.ts
export interface CreateAgentSessionOptions { resume?: { messages: ChatMessage[] }; /* … */ }
export interface AgentSession { getHistory(): ChatMessage[]; /* sendMessage, dispose unchanged */ }

// src/providers/poe-agent.ts
export function spawnPoeAgentWithAcp(options: { resumeThreadId?: string; /* … */ }): { events; done };
```

Tests (all memfs, no real LLM, fast):

- `session-store.test.ts` — save/load roundtrip, load of missing id returns undefined, corrupt JSON throws with path, version mismatch throws.
- `agent-session` tests — `resume.messages` reaches `injectResumeMessages` on the first `sendMessage`; `getHistory()` returns messages after a completed run (existing mocked-fetch harness).
- `providers.test.ts` (poe-agent) — spawn with `resumeThreadId` loads the store, reuses the threadId in `session_start`/result, seeds the session; completed run persists history; unknown threadId rejects; failed run leaves the file untouched.
- CLI handler tests — `spawn-poe-agent` forwards `resumeThreadId`, prints the resume hint in UI mode, omits it in JSON mode.
- Manual QA: `npm run dev -- spawn --agent poe-agent "remember the word zebra"`, then resume with the printed command and ask "what word did I tell you?"; verify via `npm run screenshot-poe-code -- spawn --agent poe-agent "hi"` that the hint renders well.

Rollout: no migration. Existing callers are unaffected — `resume`/`getHistory` are additive, the `AgentRunOptions.resume` widening is source-compatible, and threadId format change only affects display.

Autonomy checklist: mock LLM via the existing agent-session test harness; memfs for store and provider tests; `npm run dev -- spawn --agent poe-agent …` for spot checks; screenshot command for the hint; no network or credentials needed for unit tests.

## 5. Code plan

Create:

- `packages/poe-agent/src/session-store.ts` — `PersistedAgentSession`, `AgentSessionStore`, `createAgentSessionStore`.
- `packages/poe-agent/src/session-store.test.ts` — store unit tests (memfs).

Change:

- `packages/poe-agent/src/agent.ts` — widen `AgentRunOptions.resume` to `Pick<RunResult, "messages">`.
- `packages/poe-agent/src/agent-session.ts` — add `CreateAgentSessionOptions.resume`, seed `previousRun` from it, add `AgentSession.getHistory()`; use the runtime `ChatMessage` type instead of the local `{ role, content }` alias where history crosses the boundary.
- `packages/poe-agent/src/index.ts` — export the store and `PersistedAgentSession`.
- `packages/poe-agent/README.md` — document the sessions directory and resume behavior.
- `src/providers/poe-agent.ts` — accept `resumeThreadId`; create the store; load persisted session in `runPoeAgentAcpLifecycle` (model precedence: explicit > persisted > default); pass `{ threadId, messages }` into `createInMemoryAcpTransport`; `session/new` seeds resume messages and reuses the threadId; UUID threadIds; save history after each completed `session/prompt`.
- `src/cli/commands/spawn-poe-agent.ts` — forward `options.resumeThreadId`, stop pre-applying `DEFAULT_FRONTIER_MODEL` (defaulting moves into `spawnPoeAgentWithAcp`), print the resume hint in UI mode.
- `src/cli/poe-agent-main.ts` — add `--resume-thread-id <id>` and forward it.

Build order (branch stays green at each step):

1. `session-store.ts` + tests.
2. `agent.ts` resume-type widening + `agent-session.ts` (`resume` option, `getHistory`) + tests.
3. `src/providers/poe-agent.ts` plumbing + provider tests.
4. CLI handler + `poe-agent-main` flags + tests; manual QA + screenshot check.
