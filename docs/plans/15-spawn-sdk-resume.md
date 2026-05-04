# Spawn SDK resume

First-class resume in the `@poe-code/agent-spawn` SDK, not just a CLI hint.

## 1. What we're building

A way for SDK callers to resume a previously-spawned agent session directly from `spawn(...)`, instead of reading the "Resume: ..." hint and re-invoking the binary by hand.

Today:

- Each CLI config declares `resumeCommand(threadId, cwd) => string[]` ([types.ts:143](../../packages/agent-spawn/src/types.ts#L143)) — this plan renames it to `resume`.
- `SpawnResult.threadId` is captured from adapter events.
- Only the top-level CLI uses this — it prints a `Resume: cd ... && <binary> ...` line via `buildResumeCommand` in [shared.ts:154](../../src/cli/commands/shared.ts#L154). The SDK itself has no resume entry point.

So callers of `spawn(agentId, options)` can observe `threadId` on the result but cannot feed it back into the SDK to continue the session.

In scope:

- Resume for CLI-kind spawns (claude-code, codex, kimi, opencode, goose).
- Resume for ACP-kind spawns via the ACP client's existing `loadSession` ([acp-client.ts:457](../../packages/poe-acp-client/src/acp-client.ts#L457)).
- Caller must always provide a new `prompt` on resume. Every provider's `resume` receives the prompt and decides how to use it — no hardcoded "continue" in goose, no prompt-less resume.
- Preserves the declarative-provider rule: no `if (agentId === "...")` branches in the runner.

Out of scope:

- File-kind spawns (no resume semantics).
- Persisting threadIds anywhere — caller's responsibility.
- Changing the CLI's printed "Resume:" hint behavior.
- Auto-detecting whether an ACP agent supports `loadSession`: if the agent didn't advertise the capability, the SDK surfaces the existing ACP-client error as-is.

## 2. User-facing shape

### CLI spawn

```ts
export interface SpawnOptions {
  prompt: string;                        // required on resume too
  resume?: { threadId: string };         // NEW
  // ... existing fields unchanged
}
```

Usage:

```ts
import { spawn } from "@poe-code/agent-spawn";

const first = await spawn("claude-code", { prompt: "explain foo.ts" });
if (!first.threadId) throw new Error("agent returned no threadId");

const followup = await spawn("claude-code", {
  prompt: "now rename it to bar.ts",
  resume: { threadId: first.threadId },
});
```

When `resume` is set, the SDK uses the provider's `resume(threadId, cwd, prompt)` instead of the normal argv builder. `mode`, `model`, `mcpServers`, `args` are ignored on resume — the resume command is the provider's canonical way to continue a session and any other flag belongs to the original spawn.

### ACP spawn

```ts
export interface SpawnAcpOptions {
  agentId: string;
  prompt: string;
  resume?: { threadId: string };         // NEW
  // ... existing fields unchanged
}
```

Usage:

```ts
import { spawnAcp } from "@poe-code/agent-spawn";

const first = spawnAcp({ agentId: "gemini", prompt: "explain foo.ts" });
const firstDone = await first.done;

const followup = spawnAcp({
  agentId: "gemini",
  prompt: "now rename it to bar.ts",
  resume: { threadId: firstDone.threadId! },
});
```

When `resume` is set, the ACP runner calls `client.loadSession(threadId, cwd, mcpServers)` instead of `client.newSession(cwd, mcpServers)`. Everything else (`prompt(...)`, event stream, `done` promise) behaves identically.

### Provider-config contract change

Rename `CliSpawnConfig.resumeCommand` → `CliSpawnConfig.resume` and change both semantics and signature. The new field returns only the **prompt section** — the part of the argv that, for a fresh spawn, is `[promptFlag, prompt]`. Everything else the builder emits (`mcpArgs`, `defaultArgs`, `modelFlag` + model, mode args, `options.args`) is layered on identically to a non-resume spawn. This is what "match the spawn" means in practice.

```ts
resume?: (threadId: string, prompt: string) => string[];
```

No `cwd` argument — the builder already threads cwd through `child_process.spawn`, so the resume function does not need it.

Per-provider prompt-section replacements (verified against each binary's `--help`):

- **claude-code** — `["--resume", threadId, "-p", prompt]`
- **codex** — `["exec", "resume", threadId, prompt]`
- **kimi** — `["--session", threadId, "-p", prompt]`
- **opencode** — `["run", "--session", threadId, prompt]`
- **goose** — `["--resume", "--session-id", threadId, "--text", prompt]`

Notes on the investigation:

- **claude-code** — `--resume <id>` is a normal top-level flag and composes with `-p`, `--model`, `--mcp-config`, `--permission-mode`. Only true compositional case among the five.
- **codex** — the existing `resumeCommand` uses the *interactive* `codex resume` subcommand, which is wrong for non-interactive spawn. Correct path is `codex exec resume [SESSION_ID] [PROMPT]`, which accepts the same flags as `codex exec` (`--model`, `-c`, `--json`, `-s`, mcp config).
- **kimi** — `--session <id>` layers in cleanly. Current config's `--work-dir <cwd>` is redundant because `spawn()` already sets `cwd` via `child_process`.
- **opencode** — `opencode run --session <id> [message]` is the non-interactive resume. Current config drops `run` entirely and lands in the TUI.
- **goose** — `goose run --resume --session-id <id> --text <prompt>` with `--session-id` explicit. Current config hardcodes `"continue"` as the prompt and omits `--session-id` (so it picks "most recent" regardless of the captured `threadId`).

Four of the five existing `resumeCommand` implementations are broken; this plan fixes them as part of the rewrite.

The only current in-tree caller — `buildResumeCommand` in [shared.ts:154](../../src/cli/commands/shared.ts#L154) — is replaced in the same change. Instead of building a standalone argv, the CLI's `Resume: ...` hint now runs the full spawn builder with `resume: { threadId }` set, so the printed command is exactly what the SDK would execute.

### Error shapes

- CLI, agent has no `resume`:
  `Error: Agent "<id>" does not support resume.`
- CLI, `resume.threadId` is empty string:
  `Error: resume.threadId is required.`
- ACP, agent didn't advertise `loadSession`:
  existing ACP-client error bubbles up unchanged:
  `Cannot call "session/load" because the agent does not support session loading.`
- Caller passes a stale/unknown `threadId`: the underlying CLI or ACP agent reports its own error; SDK does not pre-validate.

## 3. Implementation details and technical decisions

### Architecture

Three modules change, all inside `packages/agent-spawn`:

- [types.ts](../../packages/agent-spawn/src/types.ts) — add `resume?: { threadId: string }` to `SpawnOptions`; rename `CliSpawnConfig.resumeCommand` → `CliSpawnConfig.resume` with the new signature `(threadId, prompt) => string[]`; add `resume?: { threadId: string }` to `SpawnAcpOptions` in [acp/spawn-acp.ts](../../packages/agent-spawn/src/acp/spawn-acp.ts).
- [spawn.ts](../../packages/agent-spawn/src/spawn.ts) — in `buildCliArgs`, when `options.resume` is set, replace the prompt section (currently `[config.promptFlag, options.prompt]`) with `config.resume(options.resume.threadId, options.prompt)`. Throw if the config has no `resume` function. Every other section (mcp, defaultArgs, model, mode, options.args) is emitted unchanged.
- [acp/spawn-acp.ts](../../packages/agent-spawn/src/acp/spawn-acp.ts) — when `options.resume` is set, call `client.loadSession(threadId, cwd, mcpServers)` instead of `client.newSession(cwd, mcpServers)`. The rest of the `done` promise (prompt turn, event stream, result shape) is identical.

One module outside the package updates its consumer:

- [src/cli/commands/shared.ts](../../src/cli/commands/shared.ts) — `buildResumeCommand(service, threadId, cwd)` is replaced with a new implementation that calls `buildSpawnArgs(agentId, { prompt: "", resume: { threadId }, cwd })` and assembles the shell string the same way (binary + quoted args, `cd <cwd> &&` prefix). The printed hint thus tracks the real SDK argv by construction. Prompt is left blank in the hint (it's a placeholder for the user to fill in) — or, alternative, omit the hint entirely and replace with `# resume via: poe-code spawn <agent> --resume <threadId> <prompt>` once the CLI exposes a `--resume` flag. Pick one in level 4.

### Edge cases — technical

- **Stdin mode + resume** — `SpawnOptions.useStdin` is ignored when `resume` is set. Resume's prompt section returns argv with the prompt inlined; the streaming-stdin protocol (used by kimi's `--input-format stream-json` and goose's `--instructions -`) is a first-message-only mechanism and has no well-defined semantics on resume. Ignoring is simpler than erroring and matches "prompt is always a plain string on resume".
- **`interactive` + resume** — resume is only supported for non-interactive spawns in v1. If `options.interactive` is true with `resume` set, throw. Interactive resume already works via the binaries' own pickers and doesn't need SDK wiring.
- **File-kind agents with `resume`** — `resolveCliConfig` already throws on non-CLI agents; the resume path runs after that check, so file-kind cases fall through to the existing error.
- **Abort / activity timeout** — no changes; both hook into the child process identically whether the argv came from fresh-spawn or resume.

### Edge cases — product

- **No `threadId` from first spawn** — caller's problem. `SpawnResult.threadId` is already `string | undefined`; callers who want to chain must check.
- **Stale `threadId`** — the underlying binary produces its own error (e.g. `error: session <uuid> not found`). SDK surfaces as non-zero exit + stderr, same as any other spawn failure.
- **`cwd` mismatch** — some binaries scope resume to the original cwd (codex, goose). If the caller resumes with a different `cwd`, the binary decides whether to honor it. SDK passes cwd through; does not second-guess.
- **ACP agent without `loadSession` capability** — `AcpClient.loadSession` already gates on `agentCapabilities.loadSession` and throws a descriptive error ([acp-client.ts:463](../../packages/poe-acp-client/src/acp-client.ts#L463)). The `spawnAcp` runner surfaces that error via the `done` promise the same way any other ACP error is surfaced today.

### ThreadId format vs. what the binary expects

The captured `SpawnResult.threadId` comes from each adapter's `session_start` event. These match the format each binary's resume flag expects — but only for binaries we already drive. Quick audit:

- **claude-code** — adapter reads `session_id` UUID; `--resume <uuid>` ✓
- **codex** — adapter reads `thread_id` UUID; `codex exec resume <uuid>` ✓ (UUIDs take precedence in the subcommand's argument parser per `codex resume --help`)
- **kimi** — adapter yields `threadId` from the stream; `--session <id>` ✓
- **opencode** — adapter reads `sessionID` (`ses_...`); `opencode run --session <ses_...>` ✓
- **goose** — **needs verification.** Goose's adapter extracts a `thread_id`-shaped value from its event stream, but `goose run --resume --session-id <id>` expects the ID format goose uses for its on-disk session files. Concretely: verify by running goose once, capturing `SpawnResult.threadId`, then re-invoking `goose run --resume --session-id <that-value> --text "hello"` and checking it resumes successfully. If it doesn't, the fix is adapter-side (extract the correct field), not config-side. Lock in level 4's manual-QA step.

### Flags / env vars / config knobs

None. `resume` is a plain option on `SpawnOptions` / `SpawnAcpOptions`. No new config-file key, no new env var, no feature flag. This is a pure SDK-surface addition.

### Migration

Breaking change on `CliSpawnConfig.resumeCommand` → `CliSpawnConfig.resume`, done in a single commit. The rename touches:

- `packages/agent-spawn/src/types.ts` (type definition)
- `packages/agent-spawn/src/configs/*.ts` (5 provider configs)
- `packages/agent-spawn/src/types.compile-check.ts` (compile-time check)
- `packages/agent-spawn/src/configs/configs.test.ts` (tests assert on the field name)
- `src/cli/commands/shared.ts` (`buildResumeCommand` consumer)
- `docs/ADDING_AGENT.md` (documents the field)

No third-party consumers of `@poe-code/agent-spawn` exist in-tree; the package is not published standalone. Verified by `grep -r "resumeCommand" .` — all hits are in the list above.

## 4. Interfaces and test plan

### Module boundaries

`packages/agent-spawn` public surface after this change:

```ts
// types.ts
export interface SpawnOptions {
  prompt: string;
  resume?: { threadId: string };
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  mcpServers?: McpSpawnConfig;
  useStdin?: boolean;       // ignored when resume is set
  interactive?: boolean;    // errors when resume is set
  signal?: AbortSignal;
  tee?: { stdout?: { write(chunk: string): void }; stderr?: { write(chunk: string): void } };
  activityTimeoutMs?: number;
  logDir?: string;
  logFileName?: string;
}

export interface CliSpawnConfig {
  // ... unchanged fields
  resume?: (threadId: string, prompt: string) => string[];
}

// acp/spawn-acp.ts
export interface SpawnAcpOptions {
  agentId: string;
  prompt: string;
  resume?: { threadId: string };
  cwd?: string;
  model?: string;
  mode?: SpawnMode;
  mcpServers?: McpSpawnConfig;
  signal?: AbortSignal;
}
```

No new exports; no new modules.

### Cross-boundary function signatures

- `buildCliArgs(config, options, stdinMode)` — behaviour change: when `options.resume` is set, the prompt section is `config.resume(options.resume.threadId, options.prompt)` instead of `[config.promptFlag, options.prompt]`. If `options.resume && !config.resume`, throw `Error(\`Agent "${config.agentId}" does not support resume.\`)`.
- `spawnAcp(options)` — branches `newSession` vs `loadSession` on `options.resume`. Returns the same `{ events, done }` shape.
- `buildSpawnArgs(agentId, options)` — no signature change; inherits the `resume` behaviour from `buildCliArgs`.
- `buildResumeCommand(service, threadId, cwd)` in `src/cli/commands/shared.ts` — internally calls `buildSpawnArgs` with `resume: { threadId }` and a placeholder prompt; returns a shell string for the CLI's hint.

### Test strategy

Unit tests (all in the agent-spawn package, all fast, no child-process spawning):

1. **`configs.test.ts`** — replace the existing `describe("resumeCommand", ...)` block with `describe("resume", ...)`. For each provider, assert `config.resume!("thread-123", "hello world")` returns the exact argv listed in level 2. Proves the per-provider contract.
2. **`spawn.test.ts` (new block or in existing)** — for each provider, call `buildSpawnArgs(agentId, { prompt: "hi", resume: { threadId: "t1" } })` and snapshot the full argv. Proves the compositional splice (mcp / defaultArgs / model / mode all still emit correctly). Use `inline snapshots` per-provider.
3. **`spawn.test.ts`** — `buildSpawnArgs` with `resume` on an agent whose config has no `resume` function (manually construct a minimal config in-test or mock `resolveConfig`) throws the expected error.
4. **`spawn.test.ts`** — `options.interactive: true` + `resume` throws.
5. **`spawn-acp.test.ts` (new)** — mock `AcpClient` so both `newSession` and `loadSession` are observable. Assert: `spawnAcp({ resume: { threadId: "t" } })` calls `loadSession("t", cwd, mcp)` and never calls `newSession`. Assert: without `resume`, `newSession` is called and `loadSession` is not.
6. **`spawn-acp.test.ts`** — when `loadSession` rejects (e.g. capability missing), the `done` promise's `SpawnResult` has `exitCode: 1` and the error message flows through `stderr`.

Integration / wiring tests:

7. **CLI hint** — unit test for `buildResumeCommand` in `src/cli/commands/shared.ts`. Given `service = "claude-code"`, `threadId = "t1"`, `cwd = "/work"`, assert the returned shell string equals the expected `cd /work && claude --resume t1 -p "<prompt>"` (or whatever placeholder form we settle on).

Manual QA (markdown doc; not a script — per [CLAUDE.md](../../CLAUDE.md) QA rule):

8. **`docs/qa/spawn-resume.md` (new)** — step-by-step plan: for each of the 5 providers, (a) run a fresh `poe-code spawn <agent> "list the files in this dir"`, capture `threadId` from output and `.threadId` from the resume hint; (b) run the SDK resume programmatically via a small dev script (`npm run dev -- spawn <agent> --resume <threadId> "now count them"`) — or, if `--resume` flag isn't part of this PR, use a `node -e` one-liner that calls `spawn()` with `resume`; (c) confirm the second run references prior context. The goose case specifically confirms the `threadId` format question raised in level 3.

E2E: not needed for this change — the existing E2E suite exercises fresh spawn; resume is a pure argv/session-loading variation.

### Rollout / migration

Single PR, single commit. `CliSpawnConfig.resumeCommand` is renamed in-place. No deprecation shim — all 5 provider configs and the one consumer update at the same time. No version bump of `@poe-code/agent-spawn` is semver-breaking for external users because the package is bundled, not published.

### Autonomy checklist

**Acceptance criteria** (concrete, checkable):

- `CliSpawnConfig.resumeCommand` is gone; `CliSpawnConfig.resume` exists with signature `(threadId, prompt) => string[]`.
- `SpawnOptions.resume` and `SpawnAcpOptions.resume` both exist as `{ threadId: string } | undefined`.
- For each of the 5 CLI providers, `config.resume(...)` returns the argv listed in level 2. (Unit test #1.)
- For each provider, a spawn dry-run with `resume` set emits a command equal to the non-resume command with only the prompt section swapped. (Unit test #2.)
- `spawnAcp` with `resume` set calls `AcpClient.loadSession`, not `newSession`. (Unit test #5.)
- `buildResumeCommand` in the CLI produces the same argv as `buildSpawnArgs(..., { resume })`. (Unit test #7.)
- `npm run test` passes (unit).
- `npm run build` succeeds (type-check catches the field rename everywhere).
- Manual QA doc executed against at least 2 providers (claude-code + goose) and the results recorded in the doc; remaining 3 providers tested opportunistically.

**Verification commands**:

- `npm run test -- packages/agent-spawn` — agent-spawn unit tests.
- `npm run test -- src/cli/commands/shared.test.ts` (if exists) or `npm run test` — CLI hint test.
- `npm run build` — whole-tree type check.
- `npm run lint` — consistency.
- `npm run dev -- spawn claude-code "list files"` → capture threadId → `node -e "require('./packages/agent-spawn').spawn('claude-code', { prompt: 'count them', resume: { threadId: '<id>' } }).then(r => console.log(r.stdout))"` — end-to-end smoke check (dev invocation is fine, does not need to be scripted).

**Fixtures / env**: none. Tests use mocked configs and mocked `AcpClient`; manual QA uses real binaries on the developer's PATH — each must be logged in already (claude auth, codex auth, etc.). Document this in the QA markdown.

**Decisions already made** (agent does not need to re-ask):

- `resume` is a function returning the prompt section only, not the whole argv.
- Signature `(threadId, prompt) => string[]` — no `cwd`.
- Prompt is always required; `useStdin` is ignored; `interactive` errors.
- Resume spans both CLI and ACP in v1.
- The 5 per-provider resume argvs in level 2 are the target — do not "optimize" them.
- No deprecation window; rename is in a single commit.

**Decisions the agent can make on its own**:

- Exact wording of error messages (e.g. "Agent X does not support resume" vs. "resume() not defined for agent X") — pick one, use it consistently.
- Test file organisation — add to existing test files or create new ones, whichever keeps the diff smaller.
- Whether `buildResumeCommand` outputs a prompt placeholder or drops the prompt entirely from the hint string — both are acceptable. Prefer the option that requires the smaller change to existing CLI output.

**Stop conditions** (agent pauses and escalates):

- Any of the 5 per-provider resume argvs fails the goose-style manual QA (i.e. the binary doesn't actually resume). Example: goose `--session-id` rejects the captured `threadId` because the adapter extracts the wrong field. This is an adapter bug, not a config bug, and changes scope — pause.
- An ACP agent we care about (gemini, opencode, goose-acp) does not advertise `loadSession` — ACP resume silently becomes unusable for that agent. Surface the list to the user.
- `buildResumeCommand`'s output (the printed "Resume:" hint) changes in a way that breaks an existing user workflow — specifically, if the hint was relying on `cd <cwd> &&` and the new version drops it. Pause and confirm before changing the hint format.

## 5. Code plan

### Files to create

- **`docs/qa/spawn-resume.md`** — manual QA steps for verifying resume against each provider binary. Structure: one section per provider with numbered steps, expected output, and the specific `threadId` flow to validate (especially goose).

### Files to change

- **`packages/agent-spawn/src/types.ts`**
  - Rename `CliSpawnConfig.resumeCommand` → `CliSpawnConfig.resume`.
  - Change signature from `(threadId: string, cwd: string) => string[]` to `(threadId: string, prompt: string) => string[]`.
  - Add `resume?: { threadId: string }` to `SpawnOptions`.
- **`packages/agent-spawn/src/spawn.ts`**
  - In `buildCliArgs`, compute the prompt section: if `options.resume`, use `config.resume(options.resume.threadId, options.prompt)`; else use the current `[config.promptFlag, options.prompt]` (or the existing `stdinMode` branch).
  - Guard: `if (options.resume && !config.resume) throw new Error(...)`.
  - Guard: `if (options.resume && options.interactive) throw new Error(...)`.
  - `stdinMode` branch is skipped when `options.resume` is set (resume argv bakes in the prompt).
- **`packages/agent-spawn/src/acp/spawn-acp.ts`**
  - Add `resume?: { threadId: string }` to `SpawnAcpOptions`.
  - In the `done` IIFE, replace the unconditional `client.newSession(...)` with: `const session = options.resume ? await client.loadSession(options.resume.threadId, cwd, acpMcp) : await client.newSession(cwd, acpMcp);`.
  - `sessionId` still comes from `session.sessionId`; event flow downstream unchanged.
- **`packages/agent-spawn/src/configs/claude-code.ts`** — `resume: (threadId, prompt) => ["--resume", threadId, "-p", prompt]`. Also remove `-p` / `--print` from `defaultArgs` if duplicated (verify against current config — claude's current config has `promptFlag: "-p"` or similar; the resume section must not re-introduce it via defaultArgs). Actual edit contingent on current config shape.
- **`packages/agent-spawn/src/configs/codex.ts`** — `resume: (threadId, prompt) => ["exec", "resume", threadId, prompt]`. Current `promptFlag: "exec"` handles the non-resume case; resume replaces both subcommand and positional prompt.
- **`packages/agent-spawn/src/configs/kimi.ts`** — `resume: (threadId, prompt) => ["--session", threadId, "-p", prompt]`.
- **`packages/agent-spawn/src/configs/opencode.ts`** — `resume: (threadId, prompt) => ["run", "--session", threadId, prompt]`.
- **`packages/agent-spawn/src/configs/goose.ts`** — `resume: (threadId, prompt) => ["--resume", "--session-id", threadId, "--text", prompt]`. The `run` subcommand stays in `defaultArgs` (already `["run", "--output-format", "stream-json"]`).
- **`packages/agent-spawn/src/types.compile-check.ts`** — update the static type assertion that references `resumeCommand` to reference `resume` with the new signature.
- **`packages/agent-spawn/src/configs/configs.test.ts`** — rename `describe("resumeCommand", ...)` to `describe("resume", ...)`, update each per-provider assertion to the new argv.
- **`src/cli/commands/shared.ts`** — rewrite `buildResumeCommand(service, threadId, cwd)` to call `buildSpawnArgs(agentId, { prompt: "<prompt>", resume: { threadId }, cwd })` and format the result as `cd <cwd> && <binary> <quoted-args>`. Retain the signature so `spawn.ts` doesn't need changes.
- **`src/cli/commands/shared.test.ts`** (if it exists; otherwise add) — unit test the rewritten `buildResumeCommand`.
- **`docs/ADDING_AGENT.md`** — update the section that documents the `resumeCommand` field to reference `resume` and the new signature (`(threadId, prompt) => string[]`).

### New function signatures

```ts
// packages/agent-spawn/src/types.ts
export interface SpawnOptions {
  // ...
  resume?: { threadId: string };
}
export interface CliSpawnConfig {
  // ...
  resume?: (threadId: string, prompt: string) => string[];
}

// packages/agent-spawn/src/acp/spawn-acp.ts
export interface SpawnAcpOptions {
  // ...
  resume?: { threadId: string };
}
```

No new functions introduced — the change is entirely a behaviour swap inside existing ones.

### Ordering

Build the branch so each commit keeps the tree green:

1. `types.ts` + `types.compile-check.ts`: rename + add option field. Tree breaks (the 5 configs still use old name).
2. Update all 5 provider configs to the new `resume` field and new argv shape. Tree now type-checks.
3. `configs.test.ts`: rename describe block, update assertions to new argv. Unit tests pass.
4. `spawn.ts`: wire `options.resume` into `buildCliArgs`. Add the two guards.
5. Add `spawn.test.ts` cases (compositional splice, error paths).
6. `acp/spawn-acp.ts`: add `resume` option and `loadSession` branch.
7. Add `spawn-acp.test.ts` cases.
8. `src/cli/commands/shared.ts`: rewrite `buildResumeCommand` to use `buildSpawnArgs`.
9. Add / update CLI hint test.
10. `docs/ADDING_AGENT.md` + `docs/qa/spawn-resume.md`.
11. Run full test suite + `npm run build` + `npm run lint`.

Each step leaves the tree compiling; steps 1→2 are the only window where types mismatch, and can be combined in the same commit if preferred.
