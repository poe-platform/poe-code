---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: skeleton-package
    title: Create the agent-human-in-loop package skeleton
    prompt: |
      Create a new workspace package at packages/agent-human-in-loop that
      mirrors the conventions of packages/agent-mcp-config (look at its
      package.json and tsconfig.json for layout — match field order, build
      scripts, and test runner).

      Files to create:

      - packages/agent-human-in-loop/package.json
        - name: "@poe-code/agent-human-in-loop"
        - type: "module"
        - main / exports → "./dist/index.js"
        - types → "./dist/index.d.ts"
        - scripts: build, test, typecheck — same pattern as agent-mcp-config
        - dependencies: {} (none)
        - devDependencies: same set as agent-mcp-config (typescript, vitest, etc.)
      - packages/agent-human-in-loop/tsconfig.json — extends the workspace
        root tsconfig, outputs to dist/.
      - packages/agent-human-in-loop/src/index.ts — placeholder export so
        the build succeeds:
        `export {};`

      Verify:

      - `npm install` from the repo root resolves the new workspace.
      - `npm run build --workspace agent-human-in-loop` succeeds.
      - `npm run test --workspace agent-human-in-loop` succeeds (no tests yet).

      Do not add a README in this task — that lands in a later task with the
      full content. Do not add runtime dependencies.
    status:
      implement: done

  - id: define-types
    title: Define the public types
    prompt: |
      Create packages/agent-human-in-loop/src/types.ts with these exact
      exported types and nothing else (no runtime code):

      ```ts
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
      ```

      `reason` is only present when the caller passed `declineInputPrompt`
      AND the user typed text. Empty string after the colon in the wire
      format collapses to "no reason field at all".

      Verify: `npm run typecheck --workspace agent-human-in-loop` passes.
    status:
      implement: open

  - id: mock-provider
    title: Implement the mock provider (TDD)
    prompt: |
      Implement a mock HumanInLoopProvider used by tests in this package
      and downstream consumers. TDD: write the test file first, see it
      fail, then implement.

      File: packages/agent-human-in-loop/src/providers/mock.test.ts

      Cases (use vitest):

      1. Value form: `mockProvider({ outcome: "approved" })` returns the
         same value on two consecutive calls.
      2. Thunk form: `mockProvider(() => ({ outcome: "declined", reason: "x" }))`
         is invoked once per call; advance through a 3-element scripted
         sequence using a closure-captured counter.
      3. Async thunk: thunk that returns `Promise.resolve({ outcome: "approved" })`
         resolves correctly when awaited.

      File: packages/agent-human-in-loop/src/providers/mock.ts

      Signature:

      ```ts
      import type { ApprovalResult, HumanInLoopProvider } from "../types.js";

      export function mockProvider(
        answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>)
      ): HumanInLoopProvider;
      ```

      Implementation: returns an object with `id: "mock"` and an async
      `requestApproval` that, if `answer` is a function, calls it and
      awaits the result; otherwise returns `answer` directly.
      `requestApproval` ignores its argument — the test scripts the
      response, not the provider.

      Verify: `npm run test --workspace agent-human-in-loop` passes; all
      three cases green.
    status:
      implement: open
      test: open

  - id: request-approval-toplevel
    title: Implement the top-level requestApproval (TDD)
    prompt: |
      Implement the package's single top-level entry point. TDD: write
      the test first.

      File: packages/agent-human-in-loop/src/request-approval.test.ts

      Use the mock provider from packages/agent-human-in-loop/src/providers/mock.ts.

      Cases:

      1. Delegates to the provider and returns the result verbatim:
         `requestApproval({ message: "hi", provider: mockProvider({ outcome: "approved" }) })`
         resolves to `{ outcome: "approved" }`.
      2. The provider's `requestApproval` receives only `ApprovalRequest`
         fields — never `provider`. Use a spy provider that records the
         arg shape and assert `provider` is not in the keys.

      File: packages/agent-human-in-loop/src/request-approval.ts

      Signature:

      ```ts
      import type { ApprovalRequest, ApprovalResult, HumanInLoopProvider } from "./types.js";

      export function requestApproval(
        args: ApprovalRequest & { provider: HumanInLoopProvider }
      ): Promise<ApprovalResult>;
      ```

      Implementation:

      ```ts
      const { provider, ...request } = args;
      return provider.requestApproval(request);
      ```

      Nothing more. No tracing, no logging, no validation. The function
      exists so downstream consumers depend on it (not the provider's own
      method) — that gives us a single place to add cross-cutting
      concerns later.

      Verify: tests pass, including the spy assertion that `provider` is
      stripped from the delegated arg.
    status:
      implement: open
      test: open

  - id: applescript-helpers
    title: Implement the AppleScript pure helpers (TDD)
    prompt: |
      Implement the pure helpers that build and parse the osascript wire
      format. These have no I/O — they are isolated so they can be
      unit-tested directly without faking subprocesses.

      TDD: write the test file first.

      File: packages/agent-human-in-loop/src/providers/osascript-script.test.ts

      Cases:

      Escape (`escapeAppleScriptString`):
        - empty string → ""
        - 'a "b" \\ c' → 'a \\"b\\" \\\\ c'  (backslash escaped before quote)
        - assert ordering: backslash MUST be escaped before quote, otherwise
          the substituted backslash gets re-escaped.

      Build (`buildScript(request, title)`):
        - Without `declineInputPrompt`: emits one line of the form
          `button returned of (display dialog "<msg>" with title "<title>" buttons {"Decline","Approve"} default button "Approve")`.
          Snapshot the exact string for `{ message: "hi" }, "T"`.
        - With `declineInputPrompt`: emits the multi-line form using
          `set firstResp to button returned of (display dialog ...)` /
          `if firstResp is "Approve" then return "APPROVED" end if` /
          `try set reason to text returned of (display dialog ...)
          return "DECLINED:" & reason on error number -128 return "DECLINED:" end try`.
          Snapshot for `{ message: "m", declineInputPrompt: "why?" }, "T"`.
        - Message containing `"` and `\` round-trips through the snapshot
          (exact escaped form appears in the script literal).

      Parse (`parseStdout`):
        - "Approve\n" → { outcome: "approved" }
        - "Decline\n" → { outcome: "declined" }
        - "APPROVED\n" → { outcome: "approved" }
        - "DECLINED:foo\n" → { outcome: "declined", reason: "foo" }
        - "DECLINED:\n" → { outcome: "declined" } (no `reason` key — verify
          via `'reason' in result === false`)
        - "weird\n" → throws an Error with message including "unexpected
          osascript output" and the raw value.

      File: packages/agent-human-in-loop/src/providers/osascript-script.ts

      Exports:

      ```ts
      import type { ApprovalRequest, ApprovalResult } from "../types.js";

      export function escapeAppleScriptString(value: string): string;
      export function buildScript(request: ApprovalRequest, title: string): string;
      export function parseStdout(out: string): ApprovalResult;
      ```

      Implementation:

      - `escapeAppleScriptString`: `value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')`.
        Order matters; the replace-on-replace test enforces it.
      - `buildScript`: branches on `declineInputPrompt === undefined`.
        Both forms use the escaped message and (when applicable) escaped
        prompt. The two-stage form is the verbatim AppleScript shown in
        the test snapshots.
      - `parseStdout`: trims trailing `\n`, then a small switch:
        - "Approve" / "APPROVED" → approved
        - "Decline" → declined (no reason)
        - starts with "DECLINED:" → declined; rest after the colon, if
          non-empty, becomes `reason`
        - otherwise throw `new Error("unexpected osascript output: " + out)`

      Verify: all snapshot + behavior tests pass.
    status:
      implement: open
      test: open
      refactor: open

  - id: osascript-provider
    title: Implement the osascript provider (TDD, fake subprocess)
    prompt: |
      Implement the provider that drives the real macOS dialog via
      `osascript -e <script>`. Tests must NOT invoke real osascript —
      they inject a fake binary. TDD: write the test first.

      File: packages/agent-human-in-loop/src/providers/osascript.test.ts

      Test seam: `osascriptProvider({ binary })` accepts a `binary` option.
      In tests, set `binary` to a path to a small Node script (or use a
      wrapper that intercepts `child_process.execFile`) that:
      - records the argv it received
      - prints a canned stdout per case

      Recommended approach: monkey-patch `node:child_process.execFile` via
      vitest's `vi.mock("node:child_process", ...)` so the provider's
      promisified call returns scripted `{ stdout, stderr }` values. This
      avoids spawning real subprocesses in tests.

      Cases:

      1. Without `declineInputPrompt`, fake stdout "Approve\n" →
         result `{ outcome: "approved" }`. Assert the argv passed to
         execFile is `[binary, ["-e", <single-line script>]]` and the
         script contains the escaped message.
      2. Without `declineInputPrompt`, fake stdout "Decline\n" →
         result `{ outcome: "declined" }`.
      3. With `declineInputPrompt`, fake stdout "APPROVED\n" →
         `{ outcome: "approved" }`. Assert the argv script is the two-stage
         form.
      4. With `declineInputPrompt`, fake stdout "DECLINED:because\n" →
         `{ outcome: "declined", reason: "because" }`.
      5. With `declineInputPrompt`, fake stdout "DECLINED:\n" →
         `{ outcome: "declined" }` (no `reason` field).
      6. ENOENT from execFile (simulate an Error with `code: "ENOENT"`)
         → throws an Error whose message contains "osascript not found".
      7. Non-zero exit with unrecognized stdout → throws an Error whose
         message contains "osascript failed" and includes the stderr.

      File: packages/agent-human-in-loop/src/providers/osascript.ts

      Signature:

      ```ts
      import type { HumanInLoopProvider } from "../types.js";

      export interface OsascriptProviderOptions {
        title?: string;   // default "Approval needed"
        binary?: string;  // default "osascript" — test seam only
      }

      export function osascriptProvider(
        options?: OsascriptProviderOptions
      ): HumanInLoopProvider;
      ```

      Implementation:

      ```ts
      import { promisify } from "node:util";
      import { execFile } from "node:child_process";
      import { buildScript, parseStdout } from "./osascript-script.js";

      const execFileAsync = promisify(execFile);

      export function osascriptProvider(options = {}) {
        const title = options.title ?? "Approval needed";
        const binary = options.binary ?? "osascript";
        return {
          id: "osascript",
          async requestApproval(request) {
            const script = buildScript(request, title);
            try {
              const { stdout } = await execFileAsync(binary, ["-e", script]);
              return parseStdout(stdout);
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error(
                  "osascript not found — provide a different provider on this platform"
                );
              }
              const stderr = (err as { stderr?: string }).stderr ?? String(err);
              throw new Error(`osascript failed: ${stderr.trim()}`);
            }
          },
        };
      }
      ```

      Note: `parseStdout` already throws on unrecognized output — case 7
      relies on that re-throwing path inside the try/catch wrapping it
      with "osascript failed". If that wrapping is unwanted, drop the
      try/catch around `parseStdout` and only wrap `execFileAsync`. Pick
      whichever satisfies the test as written; do not invent a third
      error path.

      Verify: all 7 cases pass without spawning real osascript. Run with
      no display / no GUI to confirm zero dialogs pop during tests.
    status:
      implement: open
      test: open
      refactor: open

  - id: public-exports-and-docs
    title: Wire public exports, README, and QA.md
    prompt: |
      Finalize the package's public surface and write the docs.

      File: packages/agent-human-in-loop/src/index.ts

      Replace the placeholder export with:

      ```ts
      export type {
        ApprovalRequest,
        ApprovalResult,
        HumanInLoopProvider,
      } from "./types.js";
      export { requestApproval } from "./request-approval.js";
      export { osascriptProvider } from "./providers/osascript.js";
      export type { OsascriptProviderOptions } from "./providers/osascript.js";
      export { mockProvider } from "./providers/mock.js";
      ```

      File: packages/agent-human-in-loop/README.md

      Sections, in order:

      - Overview — one paragraph: a UI-only package for asking a human
        "approve this?" before an agent proceeds. UI is providerized;
        sync vs async is the caller's choice (await the Promise or hold
        it). Approval-only; decline can capture an optional reason.
      - API — code block listing `requestApproval`, `osascriptProvider`,
        `mockProvider` with their signatures.
      - Providers — bullet list:
        - `osascriptProvider({ title?, binary? })` — macOS native dialog
          via `display dialog`. Mac only.
        - `mockProvider(answer | thunk)` — fixed or scripted answers for
          tests.
      - Env vars — single line: "None in v1."
      - AppleScript escaping note — short paragraph: messages and prompts
        are passed verbatim through the dialog; the provider escapes `"`
        and `\` for AppleScript string literals. Don't pass user-supplied
        AppleScript fragments expecting them to execute.
      - Example — minimal code block:

        ```ts
        import { requestApproval, osascriptProvider } from "@poe-code/agent-human-in-loop";

        const result = await requestApproval({
          message: "Run `rm -rf /tmp/foo`?",
          declineInputPrompt: "Why decline?",
          provider: osascriptProvider({ title: "Claude" }),
        });
        ```

      File: packages/agent-human-in-loop/QA.md

      Markdown checklist (no script). Steps:

      1. Approve path: `npm run dev -- example` (after the example task
         lands), click Approve on the first dialog → console logs
         `{ outcome: "approved" }`.
      2. Decline without prompt: Decline on the first dialog of a request
         that has no `declineInputPrompt` → `{ outcome: "declined" }`.
      3. Decline with reason: Decline on the first dialog, type "because"
         in the second dialog, click Submit → `{ outcome: "declined",
         reason: "because" }`.
      4. Decline with cancel-on-reason: Decline on the first dialog,
         click Cancel on the second dialog → `{ outcome: "declined" }`
         with no `reason` key.
      5. Quote-and-backslash safety: a message containing `"` and `\`
         renders correctly in the dialog (verify visually).
      6. Concurrency: kicking off two `requestApproval` calls in the same
         tick stacks two dialogs in the macOS UI; answering them in any
         order resolves the matching Promise.

      Verify: README parses as valid markdown; QA.md is a checklist, not
      a script.
    status:
      implement: open

  - id: visual-spot-test
    title: Add the visual spot-test example
    prompt: |
      Create a runnable example that pops the real macOS dialogs end to
      end. Used for visual confirmation, not part of automated CI.

      File: packages/agent-human-in-loop/example.ts

      Content:

      ```ts
      import { requestApproval, osascriptProvider } from "./src/index.js";

      const provider = osascriptProvider({ title: "agent-human-in-loop demo" });

      const simple = await requestApproval({
        message: "Simple approval — click Approve or Decline.",
        provider,
      });
      console.log("simple:", simple);

      const withReason = await requestApproval({
        message: "Decline-with-reason — click Decline, then type or cancel.",
        declineInputPrompt: "Why are you declining?",
        provider,
      });
      console.log("withReason:", withReason);
      ```

      Wire `npm run dev` (or the existing equivalent the workspace uses
      for ad-hoc package execution — check the root package.json scripts)
      so `npm run dev --workspace agent-human-in-loop` runs example.ts
      via tsx or ts-node. Match the convention used by other small
      packages in this repo. If no convention exists, add a script
      `"dev": "tsx example.ts"` to the package's package.json (and the
      tsx devDependency if not inherited).

      Run it once on the developer's machine and confirm:

      - First dialog renders with the simple message.
      - On the second call, declining triggers the reason dialog with
        the configured prompt.
      - Console output matches the documented `ApprovalResult` shape.

      This task is the only place real osascript runs. Do not run it
      from CI.
    status:
      implement: open
      test: open
---

# Context

Implementation pipeline for the `agent-human-in-loop` package described
in [agent-human-in-loop.md](agent-human-in-loop.md). The design plan
holds rationale (sections 1-4) and the file-by-file code map (section
5) that this pipeline executes.

Each task is self-contained — prompts include exact file paths,
signatures, and behavior so the runner does not need the design plan at
runtime.

Build order is sequential: task N depends on files written in task N-1.
The teardown step from `.poe-code/pipeline/steps.yaml` runs once at the
end, executing tests across the whole package and producing a single
`feat(agent-human-in-loop): add approval-prompt UI package` commit per
the project's "single feat commit per plan" rule.
