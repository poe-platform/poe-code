# For-loop environment lifetime — 2026-09-13

Four independent regressions failed before this repair. The initializer environment
was reused after update and the condition and body received different environments.
The loop now creates its first per-iteration environment before the condition, shares
that environment with the body, and copies bindings before update. Restored phases
retain their recorded active scope. Initializer resources retain their original scope.

Commands (zero skips):

```sh
npx vitest run packages/safe-js/src/interp/for-environment-lifetime.test.ts
npx vitest run packages/safe-js/src/interp/for-environment-lifetime.test.ts packages/safe-js/src/snapshot/guest-generator-for-continuations.test.ts packages/safe-js/src/interp/globals/eval-loop-completion.test.ts packages/safe-js/src/parse/loop-var-conflicts.test.ts
npx vitest run packages/safe-js/src/interp/resource-declarations.test.ts packages/safe-js/src/snapshot/resource-declarations.test.ts packages/safe-js/src/interp/intermediate-retention.test.ts packages/safe-js/src/interp/scope.test.ts packages/safe-js/src/interp/generator.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/src/interp/for-environment-lifetime.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Focused tests pass65; maintained neighbors pass116. Lint/build pass. The three original
failing fixtures and two recorded neighbors pass all10 variants, with zero unsupported
or execution errors. command.json records the upstream invocation; reconciliation.json
records source SHA, patch, fingerprint, source hashes and modes. Node22.23.2/ICU78.2,
Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93, ECMA-262 edition16 and ECMA-402 edition12
remain pinned. Deadlines3000ms/10000ms and budgets are unchanged.

Ordinary/async generator tests suspend at condition/body/update and repeatedly restore.
Built SDK probes pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2. They verify initializer/condition closures,
three pending and completed replays, exact saved source, constructor host-escape denial
and the100-step limit. runtime-sdk.json retains exact commands/results. CLI screenshot
was inspected and returns[0,0,0], consistent with SDK. Its command is in screenshot.log.

Residual accounting becomes151 nonpasses after this six-case repair; this is arithmetic
against the recorded integrated run, not a repeated complete audit. Remaining categories
and publication gates remain open. Local commit, remote ancestry and publication must
be recorded separately. Shared dependencies and earlier ENOSPC setup remain qualified.
