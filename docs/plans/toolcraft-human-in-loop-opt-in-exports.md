# toolcraft: human-in-loop opt-in via exports

## Goal

Core toolcraft entrypoints (`toolcraft`, `toolcraft/cli`, `toolcraft/mcp`, `toolcraft/sdk`, `toolcraft/http`) stop importing the human-in-loop runtime and `@poe-code/task-list` at module load. The runtime ships only behind the existing `toolcraft/human-in-loop` subpath export and runs only when a consumer explicitly wires it. Providers are surfaced from that export. A command declaring `humanInLoop` config without a wired runtime is a startup error. Fixes the class of failure in #517 (generated MCP servers crashed loading task-list dist on Node 18.18 without ever using approvals).

## Decisions

- Human-in-loop stays inside the toolcraft package; the boundary is the subpath export, not a new package.
- No implicit default provider. `createHumanInLoop({ provider, ... })` requires `provider`. `defaultProviderForPlatform()` remains exported for callers that want the old darwin/osascript behavior — but they pass it explicitly.
- `approvals: true` without a wired runtime is a `UserError`.
- The `./task-list` and `./agent-human-in-loop` subpath exports are removed (no consumers besides the standalone-verify script; `./human-in-loop` re-exports the providers). `verify-toolcraft-standalone.mjs` switches to importing `toolcraft/human-in-loop`.
- `@poe-code/task-list` build drops JSON import attributes (`with { type: "json" }`) in favor of `createRequire`, so its dist genuinely runs on Node 18.18 (closes #517). `engines` stays `>=18.18`.

## API

```ts
import { createHumanInLoop, osascriptProvider, defaultProviderForPlatform } from "toolcraft/human-in-loop";

runCLI(root, {
  humanInLoop: createHumanInLoop({
    provider: osascriptProvider({ title: "Approval needed" }), // required
    taskList: { dir: ".poe-code/approvals.yaml", format: "yaml-file" }, // required for async commands
    listName?, binPath?
  }),
  approvals: true
});
```

- Core owns the dep-free `HumanInLoopRuntime` interface (in `human-in-loop/types.ts`): `invoke(command, ctx, commandPath)` and `mergeApprovalsGroup(root)`. `RunCLIOptions.humanInLoop` / `RunMCPOptions.humanInLoop` / `CreateSDKOptions.humanInLoop` change type from `HumanInLoopRuntimeOptions` to `HumanInLoopRuntime`.
- `HumanInLoopRuntimeOptions` becomes the factory input (`CreateHumanInLoopOptions`) in the subpath module; the WeakMap-keyed memoization in `gate.ts`/`approval-tasks.ts` becomes factory-instance state.
- Command-level `humanInLoop` config (`mode`, `message`, `plan`, `declineInputPrompt`), its define-time validation, `HumanInLoopPending`, and `ApprovalDeclinedError` stay in core — all dependency-free.
- Services injection: core injects `humanInLoop: options.humanInLoop` (plus existing `root`) instead of `runtimeOptions`; the approvals built-in commands read the runtime from services.

## Enforcement

- New core check at entrypoint setup (`runCLI`, `createMCPServer`/`runMCP`/transport variants, `createSDK`): walk the command tree; if any command has `humanInLoop` config and `options.humanInLoop` is undefined, throw `UserError` naming the command path and pointing at `toolcraft/human-in-loop`.
- New test: entrypoint purity — static import graphs of `dist` entrypoints for `.`, `./cli`, `./mcp`, `./sdk`, `./http` must not reach `human-in-loop/gate|approval-tasks|approvals-commands|runner|spawn|default-provider`, `@poe-code/task-list`, or `@poe-code/agent-human-in-loop` (same style as the existing mcp-proxy entrypoint test).

## Changes

1. `packages/toolcraft/src/human-in-loop/types.ts` — drop task-list/provider type imports; add `HumanInLoopRuntime`.
2. `packages/toolcraft/src/human-in-loop/index.ts` — subpath entry: `createHumanInLoop`, provider re-exports from `@poe-code/agent-human-in-loop`, `defaultProviderForPlatform`, `approvalStateMachine`, error/type re-exports.
3. `gate.ts`, `approval-tasks.ts`, `runner.ts`, `approvals-commands.ts`, `spawn.ts` — restructure around the factory instance; provider always set; approvals commands read the runtime from services.
4. `mcp.ts`, `sdk.ts`, `cli.ts`, `index.ts` — remove static/lazy human-in-loop runtime imports (`optionalModulePaths.approvals/humanInLoop` go away); route through `options.humanInLoop`; add the wired-check; `createCLICommandTreeSnapshot` takes the runtime when `approvals: true`.
5. `packages/toolcraft/package.json` — remove `./task-list` and `./agent-human-in-loop` exports; delete `src/task-list.ts`, `src/agent-human-in-loop.ts`.
6. `src/cli/program.ts` (poe-code) — `createToolcraftHumanInLoopOptions` returns `createHumanInLoop({ provider: defaultProviderForPlatform(), taskList: ... })`.
7. `packages/task-list/src/backends/{yaml-file,markdown-dir}.ts` — `createRequire` instead of JSON import attributes.
8. `scripts/verify-toolcraft-standalone.mjs` — import list updated.
9. Tests: rewire human-in-loop unit/integration suites and `testing/harness.ts` to the factory; add unwired-config and approvals-without-runtime error tests; add entrypoint purity test.
10. Docs: toolcraft README human-in-loop section rewritten around explicit wiring; landing-page example updated.

## Verification

- `npm run test` for toolcraft, task-list, poe-code root suite.
- `node scripts/verify-toolcraft-standalone.mjs`.
- Spot check: `npm run dev -- <async approval command>` flow still queues/lists/runs approvals via poe-code wiring.
- Monitor release build after push.
