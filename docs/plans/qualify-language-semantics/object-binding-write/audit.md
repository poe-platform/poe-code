# Object-environment writes — 2026-09-13

Eleven independent regressions fail before the repair: ordinary/compound assignments,
four update forms, strict coercion deleting bindings, and retained-environment replay.
SetMutableBinding requires HasProperty even in sloppy contexts; strict updates must
reject a binding removed during read/coercion. One shared implementation now performs
that check and the existing sandbox-aware Set for both assignments and updates.

```sh
npx vitest run packages/safe-js/src/interp/object-binding-write.test.ts
npx vitest run packages/safe-js/src/interp/object-binding-write.test.ts packages/safe-js/src/interp/object-binding-read.test.ts packages/safe-js/src/interp/guest-proxy-with.test.ts packages/safe-js/src/snapshot/with-environment.test.ts packages/safe-js/src/snapshot/dynamic-with.test.ts packages/safe-js/src/interp/globals/eval-with-completion.test.ts packages/safe-js/src/interp/jobs.test.ts packages/safe-js/src/interp/global-scope.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/src/interp/object-binding-write.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Focused tests pass56/eight files, zero skips. Lint/build pass. Ten original failures
and recorded neighbors pass17 variants/15 files, with no unsupported/errors. Raw results,
original rows, command, source SHA/fingerprint/patch, hashes and modes are retained.
Node22.23.2/ICU78.2, Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93, edition16/edition12
remain pinned;3000ms/10000ms deadlines, budgets and runtime support are unchanged.

Built SDK probes pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. They preserve update order through three
pending and completed replay checkpoints, saved function source and constructor
host-escape denial. The inspected CLI screenshot matches the SDK's result and trace.
Commands and results are in runtime-sdk.json and screenshot.log.

Residual arithmetic becomes138 nonpasses. The typed-array-prototype sloppy assignment
case is a separate remaining defect; only its already-passing strict neighbor was run
here. Remaining categories and publication gates remain open. No whole-task success is
claimed. Shared dependency setup and separate local/remote/publication receipts apply.
