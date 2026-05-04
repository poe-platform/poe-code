---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Human-in-loop approval windows

Let a human grant an approval that persists for a time window ("allow for 1h", "allow for today"), so subsequent matching requests auto-approve until the window expires.

## 1. What we're building

Today, every gated call to `requestApproval` pops a dialog and asks again — even if the human just approved the identical thing 30 seconds ago. For overnight detached runs and long agentic loops this is the wrong shape: the human wants to grant a window of trust ("yes, this kind of action is fine for the next hour / for the rest of today") and walk away.

Add time-bounded approvals to the human-in-loop stack:

- The osascript dialog grows beyond Approve/Decline. On approval, the user picks a window: **Once**, **1 hour**, or **Today** (until local-midnight).
- A persistent grant store lives between calls. When a `requestApproval` arrives, the runtime checks the store first; on a live grant for the same key, the call resolves `{ outcome: "approved" }` without prompting.
- Async-mode (`toolcraft` queued approvals) honors live grants too — enqueue + spawn is skipped when the grant is already there, the call returns immediately as approved.
- The CLI gains `approvals grants list` / `approvals grants revoke <id>` so the human can see and tear down active windows.

Non-goals:

- Per-parameter approval rules ("approve `rm` only on `/tmp`"). Grants key on the call site (command path + a caller-chosen scope), not on parameter shape.
- Pluggable window menus per provider. The window set is fixed in v1: `once`, `1h`, `today`. New windows are a follow-up, not a config surface.
- Persistence across machines / shared stores. Grants are local to one machine, one user.
- Decline windows ("decline-for-today"). Decline stays one-shot.
- Provider branching (`if (provider.id === "osascript")`). Window selection is part of the `ApprovalResult` contract, providers without a UI for it return `window: "once"`.

## 2. User-facing shape

### API: `requestApproval` gains `grantKey` + `window`

The primitive grows two contract changes. Everything else is unchanged.

```ts
import { requestApproval, osascriptProvider } from "@poe-code/agent-human-in-loop";

const provider = osascriptProvider({ title: "poe-code" });

const result = await requestApproval({
  message: "Run `rm -rf /tmp/foo`?",
  grantKey: "tools.fs.delete",   // command path; omit for one-off prompts
  provider,
});

// result.outcome === "approved"  → result.window: "once" | "1h" | "today"
// result.outcome === "approved"  → result.grantHit: true when served from store
// result.outcome === "declined"  → unchanged ({ outcome, reason? })
```

`grantKey` is the only thing keying the cache. It is opaque to the package — the caller (toolcraft) passes a command path. Identical `grantKey` strings share a window; different strings do not.

When `grantKey` is omitted, the call is a one-off: no store lookup, no store write, dialog every time. Existing callers that don't pass `grantKey` keep their current behavior bit-for-bit.

### Dialog

One `choose from list` dialog, single click for any path.

```text
┌─ Approval needed ────────────────────────────────────┐
│  Run `rm -rf /tmp/foo`?                              │
│                                                      │
│  ◉ Approve once                                      │
│  ○ Allow for 1 hour                                  │
│  ○ Allow for today                                   │
│                                                      │
│           [ Decline ]    [ Confirm ]                 │
└──────────────────────────────────────────────────────┘
```

- Default selection is **Approve once**.
- **Confirm** → approval, with the chosen window.
- **Decline** → declined, no reason. The decline-with-reason two-stage flow (existing) still applies when `declineInputPrompt` is set: cancel-button click triggers the second dialog before resolving.
- **Esc** / window close → declined (osascript returns -128, mapped to `{ outcome: "declined" }`).

### Window semantics

| Window  | Meaning                                                         |
| ------- | --------------------------------------------------------------- |
| `once`  | No grant written. Next call re-prompts.                         |
| `1h`    | Grant valid for 60 minutes from approval timestamp.             |
| `today` | Grant valid until next local midnight (user's system timezone). |

### Toolcraft integration

Command authors do not change anything. The existing `humanInLoop` config keeps the same fields:

```ts
defineCommand({
  name: "delete",
  humanInLoop: {
    mode: "sync",
    message: ({ params }) => `Delete ${params.path}?`,
  },
  // ...
});
```

Toolcraft computes `grantKey` from the command path internally (`"tools.fs.delete"`) and threads it through `provider.requestApproval`. Grant lookup happens inside `agent-human-in-loop`; toolcraft does not see the store.

### Async mode (queued approvals)

Async-mode gating short-circuits when a grant is live for the command path:

- **Grant live** → no task is enqueued; the handler runs immediately and returns its real result, not `HumanInLoopPending`.
- **Grant absent** → existing behavior: task enqueued, runner spawned, caller receives `{ status: "pending-approval", approvalId, ... }`.
- When the runner resolves an enqueued approval through the dialog and the user picks `1h` or `today`, the grant is written before the handler fires. Subsequent async-mode calls within the window also short-circuit.

### CLI: `approvals grants`

Two new subcommands under the existing `approvals` built-in group.

```text
$ poe-code approvals grants list

ID            COMMAND PATH       WINDOW   GRANTED               EXPIRES
g_3a9f2c      tools.fs.delete    1h       2026-05-03 14:02:11   2026-05-03 15:02:11
g_88ad10      tools.shell.run    today    2026-05-03 09:18:44   2026-05-04 00:00:00
```

```text
$ poe-code approvals grants revoke g_3a9f2c

Revoked grant g_3a9f2c (tools.fs.delete).
```

```text
$ poe-code approvals grants list --json
[
  { "id": "g_3a9f2c", "commandPath": "tools.fs.delete", "window": "1h",
    "grantedAt": "2026-05-03T14:02:11Z", "expiresAt": "2026-05-03T15:02:11Z" }
]
```

`list` filters out expired entries on read and writes the cleaned file back. `revoke` errors with `UserError("no grant with id <id>")` if the id is unknown or already expired.

### Grant store location

`$XDG_DATA_HOME/poe-code/grants.json` if `XDG_DATA_HOME` is set, otherwise `~/.poe-code/grants.json`. File created lazily on first write. File format is internal — not a contract — but illustratively:

```json
{
  "schemaVersion": 1,
  "grants": [
    { "id": "g_3a9f2c", "commandPath": "tools.fs.delete", "window": "1h",
      "grantedAt": "2026-05-03T14:02:11Z", "expiresAt": "2026-05-03T15:02:11Z" }
  ]
}
```

Concurrent writers serialize through `@poe-code/file-lock`.

### Errors the user sees

- Grants file unreadable / malformed → `UserError("grants file at <path> is malformed; remove it to reset")`. We do not silently rewrite a corrupt file.
- `revoke <id>` on an unknown / expired id → `UserError("no grant with id <id>")`.
- Existing osascript errors are unchanged.
- Mock provider unchanged: still returns the scripted `ApprovalResult`. To exercise the window field in tests, set `outcome: "approved", window: "1h"`.

## 3. Implementation details and technical decisions

### Architecture

Two packages change. No new packages.

```text
packages/agent-human-in-loop/src/
├── types.ts                       # ApprovalRequest, ApprovalResult, Grant, Window
├── request-approval.ts            # adds grant-check wrapper around provider call
├── grants.ts                      # NEW — file-backed grant store + helpers
├── providers/
│   ├── osascript.ts               # dialog rebuilt as `choose from list` form
│   ├── osascript-script.ts        # buildScript handles 3-window dialog
│   └── mock.ts                    # unchanged

packages/toolcraft/src/human-in-loop/
├── gate.ts                        # async path checks live grant before enqueue
├── runner.ts                      # passes grantKey to requestApproval inside the runner
├── approvals-commands.ts          # adds `grants` subgroup (list, revoke)
└── types.ts                       # HumanInLoopRuntimeOptions gains `grants?: boolean`
```

### `agent-human-in-loop`: grant-aware `requestApproval`

The wrapper is the only place that knows about grants. Providers stay UI-only.

```text
requestApproval({ message, declineInputPrompt, grantKey, provider })
  if grantKey:
    grant = findLiveGrant(grantKey)            # reads grants.json under file-lock
    if grant: return { outcome: "approved", window: grant.window, grantHit: true }
  result = provider.requestApproval({ message, declineInputPrompt })
  if grantKey and result.outcome == "approved" and result.window != "once":
    saveGrant({ commandPath: grantKey, window: result.window })   # writes grants.json
  return result
```

`provider.requestApproval` does **not** receive `grantKey`. The grant layer wraps it. Providers that don't render the window picker return `window: "once"`; the wrapper writes nothing in that case, so non-osascript providers keep their existing behavior automatically.

### Grant store (`grants.ts`)

Single internal module exposing four functions used by the wrapper, plus two used by the toolcraft CLI commands:

- `findLiveGrant(grantKey)` — read, sweep expired, return first live grant matching the key.
- `saveGrant({ commandPath, window })` — read, sweep, append, write under file-lock.
- `listGrants()` — read, sweep, write back, return all live grants.
- `revokeGrant(id)` — read, drop the entry, write; throws `UserError` on miss.

All four go through `@poe-code/file-lock` around `grants.json`. Read-only callers still take the lock to avoid reading a half-written file.

Grant id: `g_` + 6 hex chars from `randomBytes`. Collisions are checked against the in-memory list before write.

Expiry on `today`: `new Date()` then increment day, set `00:00:00.000` in local time. Computed at write time and stored as ISO-8601. Local-midnight semantics survive sleep/wake; DST transitions are absorbed because the absolute timestamp is already pinned.

Sweep-on-read deletes any entry where `expiresAt <= now()`. The cleaned list is written back even on read paths so the file does not grow unbounded.

### File location resolver

```text
if process.env.XDG_DATA_HOME: <XDG_DATA_HOME>/poe-code/grants.json
else: <os.homedir()>/.poe-code/grants.json
```

A module-level `setGrantsFilePathForTesting(path: string | undefined)` overrides the resolver. Production never calls it.

### Toolcraft sync path

Unchanged at the call site. `gate.ts` `invokeWithHumanInLoop` already calls `provider.requestApproval(...)`; it now passes `grantKey: commandPath` through the new `requestApproval` top-level helper instead of calling the provider directly. The grant short-circuit happens inside the helper.

### Toolcraft async path

Async-mode gating gets one new step before `enqueueApproval`:

```text
if humanInLoop.mode == "async":
  if runtimeOptions.grants != false:
    grant = findLiveGrant(commandPath)
    if grant: return node.handler(ctx)         # short-circuits to real result
  // existing path: enqueue, spawn runner, return pending
```

The runner itself (`runner.ts`) now calls the top-level `requestApproval({ ..., grantKey: approval.commandPath })` instead of the bare provider, so a `1h` / `today` window picked while the runner has the dialog open is persisted before the handler fires.

### Toolcraft runtime option

`HumanInLoopRuntimeOptions` gains one optional field:

```ts
grants?: boolean;   // default true
```

When `false`, toolcraft never passes `grantKey` downstream — every call re-prompts. This is the v1 escape hatch for users who don't want any caching.

### Default-on, opt-out

The feature is on by default. No env var, no config flag in `humanInLoop` per command. Per-command exceptions ("never grant for `tools.shell.run`") are not in v1; if needed, they go through `runtimeOptions.grants = false` for the whole runtime, or a future per-command field.

### `approvals grants` subgroup

A new `defineGroup` named `grants` is appended to the existing `approvalsGroup` in `approvals-commands.ts`. Only mounted when toolcraft's existing approvals built-in is mounted (i.e. when any command uses `humanInLoop`). Two children:

- `list` — scope `["cli", "mcp", "sdk"]`. Calls `listGrants()`.
- `revoke` — scope `["cli"]`. Param `{ id: string }`. Calls `revokeGrant(id)`.

Render hooks mirror the existing `approvals list` / `approvals show` style (rich table, markdown table, json passthrough).

### Edge cases

- **Clock moves backward** (NTP correction, manual change). Live grants stay live until their absolute `expiresAt` passes; they never re-expire and re-live. Sweep is monotone with respect to the current `Date.now()` only.
- **Machine sleep across `expiresAt`**. On wake, next `findLiveGrant` sees the past timestamp and sweeps. No timer-based expiry, so sleep is not a concern.
- **Two `requestApproval` calls race for the same `grantKey`**. Both miss the grant, both call the provider, two dialogs stack. Whichever user answer arrives first writes the grant; the second answer also writes (sweep happens before append, so we end up with at most two grants for the same key — both live, both honored on next lookup, and `findLiveGrant` returns the first match). Acceptable for v1; deduplication on save is a one-line follow-up if it bites.
- **Two processes write at once** (overnight detached run + interactive shell). `@poe-code/file-lock` serializes; second writer rebases on the first writer's view.
- **`XDG_DATA_HOME` set but pointing at unwritable dir**. First write throws filesystem error wrapped in `UserError("could not write grants file at <path>: <error>")`. We do not silently fall back to `~/.poe-code` when XDG is set.
- **Corrupt `grants.json`**. Read throws `UserError("grants file at <path> is malformed; remove it to reset")`. We do not auto-repair.
- **Grants file with a future `schemaVersion`**. Same `UserError` — forward-compat is not a v1 promise; the user is asked to delete it.
- **Provider returns `window` we don't recognize** (e.g. `"forever"`). Wrapper treats unknown windows as `"once"` — no grant written. Defensive against future provider drift.
- **`grantKey` is empty string**. Wrapper treats empty same as missing — no lookup, no write. Caller bug, not our problem to enforce; documented behavior.
- **Mock provider returning `window: "1h"` in a unit test**. With `setGrantsFilePathForTesting` not set, the wrapper writes to the real `~/.poe-code/grants.json`. To prevent test pollution, every test that uses `mockProvider` with an approve outcome **must** call `setGrantsFilePathForTesting(<tmp>)` in its setup. Documented in the package README and asserted by a vitest-level setup file.

### Env vars and config

- agent-human-in-loop: still no env vars. README updated to spell that out.
- toolcraft: still no env vars. README documents `runtimeOptions.grants`.

### Compatibility / migration

- No breaking changes to public API. `requestApproval`'s `grantKey` is optional; `ApprovalResult` `approved` shape gains optional `window` and `grantHit` fields — existing consumers ignore them.
- No migration of the grants file format until we have one to migrate. `schemaVersion: 1` is the floor.

## 4. Interfaces and test plan

### Public types — `agent-human-in-loop`

```ts
// src/types.ts
export type ApprovalWindow = "once" | "1h" | "today";

export interface ApprovalRequest {
  message: string;
  declineInputPrompt?: string;
}

export type ApprovalResult =
  | { outcome: "approved"; window: ApprovalWindow; grantHit?: true }
  | { outcome: "declined"; reason?: string };

export interface HumanInLoopProvider {
  readonly id: string;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}

export interface Grant {
  id: string;            // "g_" + 6 hex
  commandPath: string;   // grantKey at write time
  window: "1h" | "today";
  grantedAt: string;     // ISO-8601
  expiresAt: string;     // ISO-8601
}
```

### Public functions — `agent-human-in-loop`

```ts
// src/request-approval.ts
export function requestApproval(
  args: ApprovalRequest & { grantKey?: string; provider: HumanInLoopProvider }
): Promise<ApprovalResult>;

// src/grants.ts
export function findLiveGrant(grantKey: string): Promise<Grant | undefined>;
export function listGrants(): Promise<Grant[]>;
export function revokeGrant(id: string): Promise<void>;
export function setGrantsFilePathForTesting(path: string | undefined): void;

// src/index.ts re-exports the above plus existing osascriptProvider, mockProvider
```

`saveGrant` is internal — only `requestApproval` calls it.

### Public types — `toolcraft/human-in-loop`

```ts
// src/human-in-loop/types.ts
export interface HumanInLoopRuntimeOptions {
  // ...existing fields...
  grants?: boolean;  // default true
}
```

`Grant` and `ApprovalWindow` re-exported through `src/human-in-loop/index.ts`.

### Test plan

#### Unit — `agent-human-in-loop`

`grants.test.ts`:

- `findLiveGrant` returns `undefined` on no match.
- `findLiveGrant` returns the live entry, ignoring expired.
- `listGrants` returns all live, in insertion order.
- `listGrants` writes back the cleaned file (expired removed) when sweep runs.
- `revokeGrant` removes one entry; subsequent `findLiveGrant` returns `undefined`.
- `revokeGrant` on unknown id throws `UserError("no grant with id <id>")`.
- File path resolver: `XDG_DATA_HOME` set → `<XDG>/poe-code/grants.json`.
- File path resolver: unset → `<homedir>/.poe-code/grants.json`.
- `setGrantsFilePathForTesting` overrides resolver; clearing it (`undefined`) restores resolver.
- Corrupt JSON → `UserError("grants file at <path> is malformed; remove it to reset")`.
- `schemaVersion` other than 1 → same `UserError`.
- `today` expiry: write at `2026-05-03T14:02:11Z` in TZ where local is UTC-5 → `expiresAt` = next local midnight as ISO. (Inject `Date` via parameter or use vi.setSystemTime + a known TZ; vi.setSystemTime is the right call here.)
- `1h` expiry: `expiresAt - grantedAt === 3600000`.
- Concurrent `saveGrant` from same process: serialized via file-lock; both entries present.

`grants.race.test.ts` (integration):

- Spawns two child Node processes. Each calls `saveGrant` with a different `commandPath` 50 times in a loop. After both exit, the file is well-formed JSON, contains 100 entries (or fewer due to expiry, but no half-writes), and `findLiveGrant` for either path resolves to a live entry.

`request-approval.test.ts`:

- No `grantKey` → no store IO; provider called every time.
- `grantKey` set, no live grant → provider called; if approved with `window: "1h"`, store now has the entry; if approved with `window: "once"`, store unchanged.
- `grantKey` set, live grant present → provider not called; result is `{ outcome: "approved", window: <stored>, grantHit: true }`.
- `grantKey` empty string → treated as missing.
- Provider returns `outcome: "declined"` → no store write, regardless of `grantKey`.
- Provider returns unknown `window` (e.g. `"forever"`) → wrapper returns approved + the unknown window passes through, but no store write.
- All cases use `setGrantsFilePathForTesting(<tmp>)` via vitest setup.

`providers/osascript-script.test.ts`:

- `buildScript` snapshot for a representative request — single `choose from list` form with `Approve once`, `Allow for 1 hour`, `Allow for today`, OK="Confirm", cancel="Decline", prompt = message, default item = `Approve once`.
- `buildScript` with `declineInputPrompt` set: emits two-stage AppleScript that runs the chooser first, then the decline-reason dialog if Decline is clicked. Snapshot.
- `parseStdout`:

  - `"Approve once\n"` → `{ outcome: "approved", window: "once" }`.
  - `"Allow for 1 hour\n"` → `{ outcome: "approved", window: "1h" }`.
  - `"Allow for today\n"` → `{ outcome: "approved", window: "today" }`.
  - `"DECLINED\n"` → `{ outcome: "declined" }`.
  - `"DECLINED:because\n"` → `{ outcome: "declined", reason: "because" }`.
  - unknown → throws.

- `escapeAppleScriptString` round-trip on quotes and backslashes.

`providers/osascript.test.ts`:

- Fake binary returning the new stdout shapes round-trips through the provider with the expected `ApprovalResult`.
- ENOENT → `UserError("osascript not found ...")`.
- Exit code with stderr containing `(-128)` → `{ outcome: "declined" }` (Esc / window close).
- Exit code with unrelated stderr → `UserError("osascript failed: ...")`.

`providers/mock.test.ts`:

- Existing cases plus: `mockProvider({ outcome: "approved", window: "1h" })` returns the window verbatim. (No store interaction in the mock — the wrapper does that.)

#### Vitest setup file

`packages/agent-human-in-loop/test/setup.ts`:

- `beforeEach`: create a tmp dir, call `setGrantsFilePathForTesting(<tmp>/grants.json)`.
- `afterEach`: clear the path (`setGrantsFilePathForTesting(undefined)`), `rm -rf` the tmp dir.

Wired in `packages/agent-human-in-loop/vitest.config.ts` (created if absent) via `setupFiles: ["./test/setup.ts"]`. The race test opts out by passing its own paths to child processes.

#### Unit — `toolcraft/human-in-loop`

`gate.test.ts` (additions):

- Sync mode, `grants: undefined` (default true) → `requestApproval` is called with `grantKey` = command path.
- Sync mode, `grants: false` → `requestApproval` is called without `grantKey`.
- Async mode, no live grant → existing behavior (enqueue, return pending).
- Async mode, live grant present → handler runs, real result returned, no task created.
- Async mode, `grants: false` → live grant ignored, existing behavior.

`runner.test.ts` (additions):

- Runner uses top-level `requestApproval` (not bare provider). When `mockProvider` returns `window: "1h"`, the runner's call writes a grant for the approval's `commandPath`.
- Runner with `grants: false` → no grant written even on `1h`.

`approvals-grants-commands.test.ts`:

- `list` with two live grants → returns both in insertion order.
- `list` after one grant expires → returns one; file is rewritten without the expired entry.
- `revoke <known-id>` → entry gone; second `revoke` of same id throws.
- `revoke <unknown-id>` → throws `UserError("no grant with id <id>")`.

`approvals-commands.test.ts`: regression — existing `approvals list / show / run` still mount and work after the new subgroup is appended.

#### Integration

`mcp-runtime.integration.test.ts` / `cli-runtime.integration.test.ts` / `sdk-runtime.integration.test.ts` (additions): for each runtime, one assertion that `humanInLoop` sync command + `mockProvider` returning `window: "1h"` writes a grant; second invocation short-circuits and returns the handler result with no provider call.

#### Manual QA — `packages/agent-human-in-loop/QA.md` additions

- Approve once flow: dialog → Confirm with `Approve once` selected → no grant in `grants list`.
- Approve 1h flow: dialog → Confirm with `Allow for 1 hour` → grant appears in `approvals grants list` with `window: 1h`; rerun command → no dialog, returns immediately.
- Approve today flow: same as above with `Allow for today`; expiry shown is next local midnight.
- Decline (button): no grant written.
- Decline (Esc / red dot): no grant written.
- Decline-with-reason: still works when `declineInputPrompt` is set.
- Revoke flow: `approvals grants revoke <id>` removes grant; next call re-prompts.
- Two parallel agent runs both grant `1h` for the same path: both writes serialize, the file ends well-formed.

#### Spot test commands

- `npm run dev -- approvals grants list` (with empty store and after a manual approve-1h).
- `npm run dev -- approvals grants revoke <id>`.
- `npm run screenshot-poe-code -- approvals grants list` (CLI table output check).

#### Snapshot / screenshot scope

- `buildScript` snapshots only — AppleScript is text, snapshots are stable.
- CLI table for `approvals grants list`: visual screenshot via `npm run screenshot-poe-code -- approvals grants list`.

### Rollout

Purely additive on the `agent-human-in-loop` API (new optional field, new shape on approve). Toolcraft consumers who pass nothing get the default-on behavior: existing apps gain windowed approvals automatically. To preserve the old "always re-prompt" behavior, set `runtimeOptions.grants = false`.

Single bundled commit covers both packages — no version skew window where toolcraft expects a `grantKey` field that agent-human-in-loop doesn't accept.

### Autonomy checklist

The implementing agent must verify before pushing:

- `grep -r "provider.id ===" packages/agent-human-in-loop/src` → empty.
- `grep -r "execFileSync\|spawnSync" packages/agent-human-in-loop/src` → empty (only async forms).
- All grant store reads and writes are wrapped in `@poe-code/file-lock`.
- `setGrantsFilePathForTesting` is imported only from test files.
- Vitest setup file is wired in `vitest.config.ts`; running the full suite without a real `~/.poe-code/grants.json` does not create one.
- README for `agent-human-in-loop` lists exports, grant store path resolution, env vars (still none), and the test seam.
- README for `toolcraft` documents `runtimeOptions.grants`.
- `package.json` of `agent-human-in-loop` adds one runtime dep: `@poe-code/file-lock`. No others.
- `npm run screenshot-poe-code -- approvals grants list` produces a readable table.
- `npm run lint`, `npm run typecheck`, `npm run test` from root all green.

## 5. Code plan

### Files to create

| File | Purpose |
| --- | --- |
| `packages/agent-human-in-loop/src/grants.ts` | File-backed grant store. Exports `findLiveGrant`, `listGrants`, `revokeGrant`, `setGrantsFilePathForTesting`, plus internal `saveGrant`. All IO under `@poe-code/file-lock`. |
| `packages/agent-human-in-loop/src/grants.test.ts` | Unit tests per §4. Uses `vi.setSystemTime`, tmp paths via `setGrantsFilePathForTesting`. |
| `packages/agent-human-in-loop/src/grants.race.test.ts` | Spawns two child Node processes that each call `saveGrant` 50 times. Asserts file integrity. |
| `packages/agent-human-in-loop/test/setup.ts` | Vitest setup file: per-test tmp grants path. |
| `packages/agent-human-in-loop/vitest.config.ts` | Created if absent; wires `setupFiles`. |
| `packages/toolcraft/src/human-in-loop/approvals-grants-commands.ts` | Defines the `grants` subgroup (`list`, `revoke`). Renders rich/markdown/json. |
| `packages/toolcraft/src/human-in-loop/approvals-grants-commands.test.ts` | Unit tests per §4. |

### Files to change

| File | Change |
| --- | --- |
| `packages/agent-human-in-loop/src/types.ts` | Add `ApprovalWindow`. Extend `ApprovalResult` approve variant with `window` + optional `grantHit`. Add `Grant`. |
| `packages/agent-human-in-loop/src/request-approval.ts` | Add `grantKey?` to args. Wrap provider call: lookup → call → maybe save. |
| `packages/agent-human-in-loop/src/request-approval.test.ts` | New cases per §4. |
| `packages/agent-human-in-loop/src/providers/osascript-script.ts` | Replace `buildScript` with single `choose from list` form (windows + Decline cancel button). Two-stage variant when `declineInputPrompt` set: `choose from list` → second dialog only when Decline. Update `parseStdout` for `Approve once` / `Allow for 1 hour` / `Allow for today` / `DECLINED` / `DECLINED:<reason>`. |
| `packages/agent-human-in-loop/src/providers/osascript-script.test.ts` | Snapshot regenerated. New `parseStdout` cases. |
| `packages/agent-human-in-loop/src/providers/osascript.ts` | No structural change; pick up new `parseStdout` outputs through the existing helper boundary. |
| `packages/agent-human-in-loop/src/providers/osascript.test.ts` | Update fake-binary stdout strings to the new outputs. |
| `packages/agent-human-in-loop/src/providers/mock.ts` | No code change. (Type widening is automatic.) |
| `packages/agent-human-in-loop/src/index.ts` | Re-export `findLiveGrant`, `listGrants`, `revokeGrant`, `setGrantsFilePathForTesting`, `ApprovalWindow`, `Grant`. |
| `packages/agent-human-in-loop/package.json` | Add `@poe-code/file-lock` to `dependencies`. |
| `packages/agent-human-in-loop/README.md` | Document the grant store, file path, `setGrantsFilePathForTesting`, per-package env vars (still none), and the new dialog. |
| `packages/agent-human-in-loop/QA.md` | Add manual flows per §4. |
| `packages/agent-human-in-loop/example.ts` | Show window picker; print result. |
| `packages/toolcraft/src/human-in-loop/types.ts` | Add `grants?: boolean` to `HumanInLoopRuntimeOptions`. |
| `packages/toolcraft/src/human-in-loop/gate.ts` | Sync path: thread `grantKey: commandPath` through new `requestApproval`. Async path: `findLiveGrant(commandPath)` short-circuit before `enqueueApproval`, gated by `runtimeOptions.grants !== false`. |
| `packages/toolcraft/src/human-in-loop/gate.test.ts` | Add cases per §4. |
| `packages/toolcraft/src/human-in-loop/runner.ts` | Replace bare `provider.requestApproval` call with top-level `requestApproval({ ..., grantKey: approval.commandPath })` (when grants enabled). |
| `packages/toolcraft/src/human-in-loop/runner.test.ts` | Add cases per §4. |
| `packages/toolcraft/src/human-in-loop/approvals-commands.ts` | Append `grantsGroup` (from new file) to `approvalsGroup.children`. No other change. |
| `packages/toolcraft/src/human-in-loop/index.ts` | Re-export `Grant`, `ApprovalWindow`. |
| `packages/toolcraft/README.md` | Document `runtimeOptions.grants`. |
| `packages/toolcraft/src/human-in-loop/mcp-runtime.integration.test.ts` | Add the grant-hit assertion per §4. |
| `packages/toolcraft/src/human-in-loop/cli-runtime.integration.test.ts` | Same. |
| `packages/toolcraft/src/human-in-loop/sdk-runtime.integration.test.ts` | Same. |

### Function signatures

```ts
// agent-human-in-loop/src/grants.ts
export function findLiveGrant(grantKey: string): Promise<Grant | undefined>;
export function listGrants(): Promise<Grant[]>;
export function revokeGrant(id: string): Promise<void>;
export function setGrantsFilePathForTesting(path: string | undefined): void;
// internal
export function saveGrant(input: { commandPath: string; window: "1h" | "today" }): Promise<Grant>;

// agent-human-in-loop/src/request-approval.ts
export function requestApproval(
  args: ApprovalRequest & { grantKey?: string; provider: HumanInLoopProvider }
): Promise<ApprovalResult>;

// agent-human-in-loop/src/providers/osascript-script.ts
export function buildScript(request: ApprovalRequest, title: string): string;
export function parseStdout(out: string): ApprovalResult;
export function escapeAppleScriptString(value: string): string;

// toolcraft/src/human-in-loop/approvals-grants-commands.ts
export const grantsGroup: Group<ApprovalBuiltInServices>;
```

### Build order

TDD throughout. Each step ends green.

1. **Types extension** — update `agent-human-in-loop/src/types.ts`. Add `ApprovalWindow`, extend `ApprovalResult`, add `Grant`. Run `npm run build --workspace agent-human-in-loop`. No new tests yet.
2. **Grant store, red → green** — write `grants.test.ts` covering all §4 cases except the race. Implement `grants.ts` (file-lock, sweep-on-read, schemaVersion gate, path resolver). Tests pass. No real disk pollution.
3. **Vitest setup wiring** — create `test/setup.ts` and `vitest.config.ts`; setup applies tmp paths around every test. Verify by running step-2 tests with the setup file in place.
4. **Race test** — write `grants.race.test.ts` spawning two child processes. Implement only if the file-lock integration needs adjustment; expectation is it passes against the `grants.ts` from step 2.
5. **`requestApproval` wrapper, red → green** — extend `request-approval.test.ts` for the new cases. Update `request-approval.ts` to accept `grantKey`, do lookup-call-write. Tests pass.
6. **AppleScript single-form, red → green** — update `osascript-script.test.ts` snapshots and `parseStdout` cases. Update `osascript-script.ts`. Tests pass.
7. **osascript provider stdout** — update `osascript.test.ts` fake-binary stdout. Adjust provider only if `parseStdout`'s contract changed.
8. **Public exports** — update `agent-human-in-loop/src/index.ts`. Update `package.json` (`@poe-code/file-lock` dep). Update `README.md` and `QA.md`.
9. **Build + test agent-human-in-loop** — `npm run build --workspace agent-human-in-loop`, `npm run test --workspace agent-human-in-loop`. Green.
10. **Toolcraft runtime option** — update `toolcraft/src/human-in-loop/types.ts`. Build green.
11. **Toolcraft sync gate, red → green** — extend `gate.test.ts` for sync grantKey threading. Update `gate.ts` sync branch.
12. **Toolcraft async gate, red → green** — extend `gate.test.ts` for async short-circuit + `grants: false`. Update `gate.ts` async branch.
13. **Runner, red → green** — extend `runner.test.ts`; update `runner.ts` to thread `grantKey`.
14. **Approvals grants subgroup, red → green** — write `approvals-grants-commands.test.ts`; implement `approvals-grants-commands.ts`; mount in `approvals-commands.ts`.
15. **Toolcraft re-exports + README** — `toolcraft/src/human-in-loop/index.ts`, `toolcraft/README.md`.
16. **Integration tests** — extend `mcp-runtime.integration.test.ts`, `cli-runtime.integration.test.ts`, `sdk-runtime.integration.test.ts`.
17. **Build + test toolcraft** — `npm run build --workspace toolcraft`, `npm run test --workspace toolcraft`. Green.
18. **Visual screenshot** — `npm run screenshot-poe-code -- approvals grants list` to verify the new table renders correctly. Capture for QA.md.
19. **Spot test** — run a sample command twice through `npm run dev`; first call pops the dialog, second call short-circuits. Confirm `approvals grants revoke` clears it.
20. **Sweep** — `npm run lint`, `npm run typecheck`, `npm run test` from root. All green.
21. **Commit** — single conventional commit `feat(agent-human-in-loop,toolcraft): time-bounded approval grants`. Files committed individually per CLAUDE.md (no `git add -A`). Plan doc included in the commit. After ship, move plan to `docs/plans/archive/`.
