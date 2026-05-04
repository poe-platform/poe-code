---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/ralph.schema.json
kind: ralph
version: 1
status:
  state: in_progress
  iteration: 0
---

# agent-human-in-loop

A UI-only package for asking a human "approve this?" before an agent proceeds. Toolcraft (and potentially other agent packages) call into it to gate actions on human consent. The package owns the prompt UI and nothing else.

## 1. What we're building

A package `agent-human-in-loop` that exposes one primitive — `requestApproval` — backed by swappable UI providers. Each provider is one file: it knows how to render an approval dialog, capture the answer, and return a structured result. The runtime never branches on provider id.

Built-in providers v1:

- `osascript` — native macOS dialog via `display dialog` (the demo from earlier in the conversation).
- `mock` — fixed/scripted answers for tests.

Non-goals:

- Tool execution, scheduling, queueing, correlation of "tool to run" with "answer received" — those belong to the consumer (toolcraft).
- Generic prompts (free text input, multi-choice). Approvals only. Decline-with-reason is the one structured variant.
- Notification-only / banner-only flows that do not return an answer.
- Cross-platform native dialogs. macOS only in v1; everything else needs a user-supplied provider.
- Cancellation / `AbortSignal` support — defer until a consumer asks.
- Theming / design-system integration. The osascript dialog is OS-themed; design-system stays terminal.

## 2. User-facing shape

### Single primitive

```ts
import { requestApproval, osascriptProvider } from "@poe-code/agent-human-in-loop";

const provider = osascriptProvider({ title: "Claude" });

const result = await requestApproval({
  message: "Run `rm -rf /tmp/foo`?",
  provider,
});

if (result.outcome === "approved") {
  await runTheTool();
} else {
  log(`declined${result.reason ? `: ${result.reason}` : ""}`);
}
```

### Decline with reason

A second optional field promotes decline into a two-stage flow inside one provider call:

```ts
const result = await requestApproval({
  message: "Run `rm -rf /tmp/foo`?",
  declineInputPrompt: "Why are you declining?",
  provider,
});
// result: { outcome: 'approved' }
//       | { outcome: 'declined' }                    // declined w/o prompt
//       | { outcome: 'declined', reason: '...' }     // declined w/ prompt and text
//       | { outcome: 'declined' }                    // declined w/ prompt and cancel-on-reason
```

When `declineInputPrompt` is unset, decline returns `{ outcome: 'declined' }` and never asks for a reason.

### Sync vs async — caller decision, not API surface

`requestApproval` returns a `Promise<ApprovalResult>`. The provider eagerly renders the dialog the moment the call is made (the osascript subprocess starts inside the executor). Sync vs async is then purely how the caller consumes the promise:

```ts
// sync — block this code path
const r = await requestApproval({ message, provider });

// async — fire and forget here, await later in toolcraft
const pending = requestApproval({ message, provider });
doUnrelatedWork();
const r = await pending; // resolves whenever the user clicks
```

There is no second "fireAndForget" function. Toolcraft owns "remember which tool to run when this resolves" — that's its existing job, not ours.

### Mock provider for tests

```ts
import { mockProvider } from "@poe-code/agent-human-in-loop";

const provider = mockProvider({ outcome: "declined", reason: "no" });
// or scripted:
const provider = mockProvider(() => ({ outcome: "approved" }));
```

`mockProvider` accepts a value or a thunk. The thunk is invoked once per `requestApproval` call so tests can advance through a sequence.

### Errors the user sees

- osascript exits non-zero for any reason that is not "user dismissed" → throws `UserError` with the underlying stderr line.
- Provider id collision when wiring multiple providers in a registry (see §3) → throws synchronously at registry construction.
- The osascript binary is missing (non-mac) → throws `UserError` at first call. Provider does not probe at construction.

## 3. Implementation details and technical decisions

### Where the code lives

New package `packages/agent-human-in-loop/`:

```text
packages/agent-human-in-loop/
├── package.json
├── README.md
├── src/
│   ├── index.ts              # public exports
│   ├── types.ts              # ApprovalRequest, ApprovalResult, HumanInLoopProvider
│   ├── request-approval.ts   # top-level requestApproval()
│   ├── providers/
│   │   ├── osascript.ts
│   │   └── mock.ts
│   └── ...test files alongside
```

No new dependencies. The osascript provider uses `node:child_process` only.

### Provider contract

```ts
export interface HumanInLoopProvider {
  readonly id: string;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}
```

`requestApproval` (top-level) is a thin pass-through that exists so consumers depend on the function, not on a specific provider instance method shape. It also lets us add cross-cutting concerns (e.g. tracing) later in one place without rewriting providers.

```ts
// src/request-approval.ts
export function requestApproval(
  args: ApprovalRequest & { provider: HumanInLoopProvider }
): Promise<ApprovalResult> {
  const { provider, ...request } = args;
  return provider.requestApproval(request);
}
```

There is **no** `if (provider.id === "osascript")` anywhere. Each provider file owns its rendering and parsing. New providers (a future `slack`, `web`, `stdin`) ship as one file each.

### osascript provider — single subprocess per call

The provider compiles the request into one AppleScript string and runs `osascript -e <script>` once. Two-stage decline is encoded inside the script so we don't shell out twice.

Script for `requestApproval` with `declineInputPrompt` unset:

```applescript
button returned of (display dialog "<message>" with title "<title>" buttons {"Decline","Approve"} default button "Approve")
```

Output is `Approve` or `Decline`.

Script for `requestApproval` with `declineInputPrompt` set:

```applescript
set firstResp to button returned of (display dialog "<message>" with title "<title>" buttons {"Decline","Approve"} default button "Approve")
if firstResp is "Approve" then
  return "APPROVED"
end if
try
  set reason to text returned of (display dialog "<declineInputPrompt>" default answer "" with title "<title>" buttons {"Cancel","Submit"} default button "Submit")
  return "DECLINED:" & reason
on error number -128
  return "DECLINED:"
end try
```

Cancel on the reason dialog (`error -128`, the standard "user canceled" code) collapses to `DECLINED:` with no reason. Cancel on the first dialog cannot happen because both buttons are present and there is no Cancel button — the dialog requires a click.

String escaping: every user-supplied string (`message`, `title`, `declineInputPrompt`) is escaped for AppleScript's `"..."` literal — the only unsafe characters are `"` and `\`. We do this with a small local helper, not a library. No interpolation of arbitrary AppleScript.

Parsing: split the trimmed stdout on the first `:`. Prefix `APPROVED` → approved. Prefix `DECLINED` → declined; the suffix (possibly empty) is the reason. Anything else → `UserError`.

The provider exposes one factory:

```ts
export function osascriptProvider(options?: {
  title?: string;            // defaults to "Approval needed"
  binary?: string;           // defaults to "osascript"; tests inject a fake
}): HumanInLoopProvider;
```

`binary` is the test seam. Production callers never set it.

### Mock provider

```ts
export function mockProvider(
  answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>)
): HumanInLoopProvider;
```

The thunk lets a test script a sequence by closing over a counter. Returning a Promise lets tests model latency without timers.

### Registry — only if needed

Toolcraft will likely select a provider per command policy ("this command needs human approval, that one auto-approves"). The selection logic belongs in toolcraft, not here. Our package exposes provider factories and the `requestApproval` entry point and stops there. No registry, no DI container, no global default. If toolcraft ends up needing one we add it in toolcraft, not by exporting state from this package.

### Edge cases

- `message` containing `"` or `\` → escaped by the helper; verified by unit test against literal strings.
- Empty `message` → AppleScript renders an empty dialog; we don't second-guess. Caller's responsibility to pass something meaningful.
- `declineInputPrompt: ""` → treated as set; the second dialog is shown with an empty prompt label. Most likely a caller bug — but we do not silently downgrade to "no reason flow" because that would be a hidden if/case.
- osascript binary not installed (non-mac, or stripped Mac) → `child_process.execFile` rejects with `ENOENT`; we map to `UserError("osascript not found — provide a different provider on this platform")`.
- osascript exits with a non-zero code that is not -128 (e.g. compilation error if our string escaping fails) → `UserError` with the stderr line. This is the "we have a bug" path; the test suite should make it unreachable.
- Concurrent `requestApproval` calls → each spawns its own subprocess, each renders its own dialog. macOS will stack them; the user sees them sequentially. We do not serialize; that's a consumer concern.

### Open questions

- Do we want a `stdin` provider for non-Mac/CI? Suggesting **no** for v1 — toolcraft's CI path will pass `mockProvider` or skip approvals altogether. A real stdin provider only matters once a human is sitting at a non-Mac terminal and that is not the immediate use case.
- Do we want a built-in `autoApprove` / `autoDeny` provider? Suggesting **no** — those are policies, and policies belong in toolcraft. A test using `mockProvider({ outcome: 'approved' })` already covers the same ground.
- Do we need an `icon` field (caution / informational) in `ApprovalRequest`? Useful for osascript (`with icon caution`) but only osascript can render it — adding it leaks osascript-shaped fields into the contract. Suggesting **no** for v1; revisit if a second provider also wants it.

## 4. Interfaces and test plan

### Public API

```ts
// src/types.ts
export interface ApprovalRequest {
  message: string;
  declineInputPrompt?: string;
}

export type ApprovalResult =
  | { outcome: "approved" }
  | { outcome: "declined"; reason?: string };

export interface HumanInLoopProvider {
  readonly id: string;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}

// src/index.ts
export type { ApprovalRequest, ApprovalResult, HumanInLoopProvider } from "./types.js";
export { requestApproval } from "./request-approval.js";
export { osascriptProvider } from "./providers/osascript.js";
export { mockProvider } from "./providers/mock.js";
```

`requestApproval` accepts `ApprovalRequest & { provider: HumanInLoopProvider }` and returns `Promise<ApprovalResult>`.

### Test plan

Per project rules: `memfs` is not relevant here (no fs writes). Tests are fast, do not pop dialogs, do not call real `osascript`.

#### Unit tests

`packages/agent-human-in-loop/src/request-approval.test.ts`:

- delegates to the provider and returns its result verbatim
- passes through `message` and `declineInputPrompt`; does not pass `provider` into `provider.requestApproval`

`packages/agent-human-in-loop/src/providers/mock.test.ts`:

- value form returns the same result for every call
- thunk form is invoked once per call; supports a sequence
- thunk returning a Promise resolves correctly

`packages/agent-human-in-loop/src/providers/osascript.test.ts` — uses an injected fake `binary` that records argv and returns canned stdout. **No real osascript.**

- without `declineInputPrompt`:
  - script contains `Approve`/`Decline` buttons and the (escaped) message + title
  - stdout `Approve\n` → `{ outcome: 'approved' }`
  - stdout `Decline\n` → `{ outcome: 'declined' }`
- with `declineInputPrompt`:
  - script contains the two-stage AppleScript; the prompt and message are both escaped
  - stdout `APPROVED\n` → `{ outcome: 'approved' }`
  - stdout `DECLINED:because\n` → `{ outcome: 'declined', reason: 'because' }`
  - stdout `DECLINED:\n` → `{ outcome: 'declined' }` (no reason — cancel on second dialog)
- escaping:
  - message containing `"` and `\` round-trips through the script literal
  - empty `declineInputPrompt` is still treated as set (second dialog is rendered)
- error mapping:
  - `ENOENT` from execFile → `UserError("osascript not found ...")`
  - non-zero exit with unrecognized stdout → `UserError` carrying stderr

#### Integration / spot test

A README example file, runnable via `npm run dev -- <example>`, that calls `requestApproval` with the real osascript provider once for the simple case and once for decline-with-reason. Used for visual confirmation; not part of automated CI.

#### QA markdown

`packages/agent-human-in-loop/QA.md` with a checklist:

- approve path returns approved
- decline without prompt returns declined
- decline with prompt → reason populated; cancel on second dialog → declined no reason
- message containing quotes renders correctly
- two concurrent calls show two stacked dialogs (macOS native behavior)

#### Snapshot / screenshot

Not applicable — this package draws no terminal UI. The osascript dialog is a native window; we do not screenshot it.

### Package metadata

- `package.json`: name `@poe-code/agent-human-in-loop`, type `module`, exports `./dist/index.js`, dependencies = none, devDependencies = the standard test stack.
- `README.md`: required by project rule. Lists the API, the two providers, the AppleScript escaping note, and a "no env vars in v1" line so the env-vars-in-readme rule is satisfied explicitly.

### Rollout

Purely additive. Nothing imports from this package today; toolcraft adopts it in a follow-up plan. No deprecations. No version coupling with toolcraft until toolcraft starts depending on it, at which point a single matching changeset bumps both.

### Autonomy checklist

An agent picking this up should be able to ship without asking:

- Build: `npm run build --workspace agent-human-in-loop`.
- Unit tests: `npm run test --workspace agent-human-in-loop`.
- The osascript provider must accept a `binary` option and tests must use a fake — no test invokes real `osascript`.
- No `if (provider.id === ...)` branches anywhere in `src/`. Verified by grep.
- No new top-level dependencies in `package.json`.
- README exists and documents: exports, providers, env vars (none), AppleScript-escaping note.
- Plan rule: this file lives at `docs/plans/agent-human-in-loop.md`; the implementation commit moves it to `docs/plans/archive/` only after the package ships.

## 5. Code plan

### Files to create

| File | Purpose |
| --- | --- |
| `packages/agent-human-in-loop/package.json` | Package manifest. `name: "@poe-code/agent-human-in-loop"`, `type: "module"`, `main`/`exports` → `dist/index.js`, `types` → `dist/index.d.ts`. No runtime deps. devDeps mirror an existing small package (e.g. `agent-mcp-config`). |
| `packages/agent-human-in-loop/tsconfig.json` | Extends the workspace root tsconfig. Output `dist/`. |
| `packages/agent-human-in-loop/README.md` | Required by project rule. Sections: Overview, API (`requestApproval`, `osascriptProvider`, `mockProvider`), Providers, Env vars (none), AppleScript-escaping note, Example. |
| `packages/agent-human-in-loop/QA.md` | Manual checklist per §4. Markdown, not a script. |
| `packages/agent-human-in-loop/src/types.ts` | `ApprovalRequest`, `ApprovalResult`, `HumanInLoopProvider`. No runtime code. |
| `packages/agent-human-in-loop/src/request-approval.ts` | The single top-level function. Strips `provider` off the args and delegates. |
| `packages/agent-human-in-loop/src/request-approval.test.ts` | Two cases: delegates verbatim; does not pass `provider` into the provider's own `requestApproval`. Uses `mockProvider`. |
| `packages/agent-human-in-loop/src/providers/mock.ts` | `mockProvider(answer)`. Value or thunk; thunk may return `Promise`. |
| `packages/agent-human-in-loop/src/providers/mock.test.ts` | Three cases per §4. |
| `packages/agent-human-in-loop/src/providers/osascript.ts` | `osascriptProvider({ title?, binary? })`. Builds AppleScript, runs `execFile`, parses stdout. |
| `packages/agent-human-in-loop/src/providers/osascript.test.ts` | Cases per §4 — uses injected fake `binary`. |
| `packages/agent-human-in-loop/src/providers/osascript-script.ts` | Pure helpers: `buildScript(request, title)`, `escapeAppleScriptString(s)`, `parseStdout(out)`. Split out so the provider file stays tiny and the helpers are unit-tested directly. |
| `packages/agent-human-in-loop/src/providers/osascript-script.test.ts` | Round-trip escaping; `buildScript` snapshot for both single- and two-stage forms; `parseStdout` for `Approve` / `Decline` / `APPROVED` / `DECLINED:foo` / `DECLINED:` / unknown → throws. |
| `packages/agent-human-in-loop/src/index.ts` | Public re-exports per §4. |
| `packages/agent-human-in-loop/example.ts` | Two-call demo (simple approval; decline-with-reason). Invoked via `npm run dev -- ...` for the visual spot-test. Not part of CI. |

No files to change in other packages. This is purely additive; toolcraft adopts it in a follow-up plan.

### Function signatures

```ts
// src/types.ts
export interface ApprovalRequest {
  message: string;
  declineInputPrompt?: string;
}

export type ApprovalResult =
  | { outcome: "approved" }
  | { outcome: "declined"; reason?: string };

export interface HumanInLoopProvider {
  readonly id: string;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}

// src/request-approval.ts
export function requestApproval(
  args: ApprovalRequest & { provider: HumanInLoopProvider }
): Promise<ApprovalResult>;

// src/providers/mock.ts
export function mockProvider(
  answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>)
): HumanInLoopProvider;

// src/providers/osascript.ts
export interface OsascriptProviderOptions {
  title?: string;   // default "Approval needed"
  binary?: string;  // default "osascript" — test seam only
}
export function osascriptProvider(options?: OsascriptProviderOptions): HumanInLoopProvider;

// src/providers/osascript-script.ts (internal)
export function escapeAppleScriptString(value: string): string;
export function buildScript(request: ApprovalRequest, title: string): string;
export function parseStdout(out: string): ApprovalResult;
```

### Internal logic — the only places worth pinning down

`escapeAppleScriptString`:

```ts
return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
```

That is the entire surface. Order matters: backslash first, then quote.

`buildScript` branches on `declineInputPrompt`:

- unset → emits the one-line `button returned of (display dialog ... buttons {"Decline","Approve"} default button "Approve")` form
- set   → emits the `set firstResp / if / try ... on error number -128 / DECLINED:` form shown verbatim in §3

`parseStdout`:

- trim trailing `\n`
- exact `"Approve"` → `{ outcome: "approved" }`
- exact `"Decline"` → `{ outcome: "declined" }`
- exact `"APPROVED"` → `{ outcome: "approved" }`
- starts with `"DECLINED:"` → `{ outcome: "declined", reason: rest || undefined }` (empty string after the colon ⇒ no `reason` field)
- anything else → throw `UserError("unexpected osascript output: <out>")`

`osascriptProvider`'s `requestApproval`:

```ts
const script = buildScript(request, title);
try {
  const { stdout } = await execFileAsync(binary, ["-e", script]);
  return parseStdout(stdout);
} catch (err) {
  if (isEnoent(err)) throw new UserError("osascript not found ...");
  throw new UserError(`osascript failed: ${stderrFrom(err)}`);
}
```

`UserError` comes from wherever the workspace already exposes it (e.g. `@poe-code/agent-spawn` or `process-runner` — pick whichever is already a dep of `agent-mcp-config`-tier packages, to avoid pulling in a heavier package). If no existing dep is a clean fit, define a local `UserError` in `src/types.ts` — minor duplication is fine here per the dependency-minimalism rule, and it stays internal.

### Build order

TDD per CLAUDE.md. Each step ends green.

1. **Skeleton** — create `package.json`, `tsconfig.json`, empty `src/index.ts` with a placeholder export. `npm run build --workspace agent-human-in-loop` and `npm run test --workspace agent-human-in-loop` both pass with no tests.
2. **Types** — write `src/types.ts`. Add `compile-check` patterns matching neighbour packages if they exist, otherwise skip — types alone don't need a runtime test.
3. **Mock provider, red → green** — write `mock.test.ts` first (3 cases). Implement `mock.ts`. Tests pass.
4. **Top-level `requestApproval`, red → green** — write `request-approval.test.ts` (2 cases) using `mockProvider`. Implement `request-approval.ts`. Tests pass.
5. **AppleScript helpers, red → green** — write `osascript-script.test.ts` covering escape, both `buildScript` shapes, and every `parseStdout` branch. Implement `osascript-script.ts`. Tests pass without ever shelling out.
6. **osascript provider, red → green** — write `osascript.test.ts` using an injected fake `binary` whose stdout is canned per case. Implement `osascript.ts` calling the helpers from step 5 and the injected binary. Tests pass.
7. **Public exports + README + QA.md** — finalize `src/index.ts`. Write README and QA.md per §4. No code changes here.
8. **Visual spot-test** — `npm run dev -- example` (or whatever the example wiring is) to confirm both the simple-approval and decline-with-reason flows still pop the real macOS dialog. Document in QA.md.
9. **Sweep** — `npm run test`, `npm run lint`, `npm run typecheck` from the root. No `npm run screenshot-poe-code` — this package draws no terminal UI.
10. **Commit** — single `feat(agent-human-in-loop): add approval-prompt UI package` commit. Files committed individually per CLAUDE.md (no `git add -A`). The plan doc `docs/plans/agent-human-in-loop.md` is part of this commit.

### Autonomy gates (re-emphasized from §4)

The implementing agent must verify before pushing:

- `grep -r "provider.id ===" packages/agent-human-in-loop/src` → empty.
- `grep -r "execFileSync\|spawnSync" packages/agent-human-in-loop/src` → empty (only async forms).
- No real `osascript` invocation in the test suite. Run `npm run test --workspace agent-human-in-loop` with no display (no dialogs should pop).
- README lists exports, providers, and an explicit "no env vars" line.
- `package.json` `dependencies` is `{}` (or absent). Only `devDependencies` may exist.
