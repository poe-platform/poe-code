# Generator reentry delivery reconciliation — 2026-09-13

The clean delivered candidate aa132423ae954e705c7396e2e5dfcea9092f5fa8 reproduced
all six original GeneratorPrototype next/return/throw executing-state failures.
Earlier error-completion qualification only covered an uncommitted working patch.
Reused its recorded independent regression and exact three-line iteration.ts patch,
leaving the original dirty source and untracked regression unchanged.

The regression fails **four/four** on the delivered candidate with fatal SandboxError
reentry. After the existing GeneratorValidate check is placed before the host running
state guard, **136 tests/seven files pass**, zero skips. Guest recursive next/return/
throw and for-of receive catchable TypeError without changing generator state. The
host running-state guard remains tested and unchanged. The regression verifies native
traces, catch/finally, continued yield and completion, and completed checkpoint replay.

Test command: `npx vitest run packages/safe-js/src/interp/generator-reentry-qualification.test.ts packages/safe-js/src/interp/running-state.test.ts packages/safe-js/src/interp/generator.test.ts packages/safe-js/src/interp/iterator-close.test.ts packages/safe-js/src/snapshot/guest-generator-restore.test.ts packages/safe-js/src/snapshot/guest-generator-catch-iterator.test.ts packages/safe-js/src/realm-callback-phases.test.ts`.
Scoped lint: `npx eslint packages/safe-js/src/interp/iteration.ts packages/safe-js/src/interp/generator-reentry-qualification.test.ts`, exit0.

The six recorded failing variants and their six original neighboring controls pass:
**six files /12 variants /12 passed**, zero failures/unsupported/errors. Exact
commands, SHA, fingerprint, Node22.23.2/ICU78.2, original fixture hashes and terminal
report are retained here. Original 3000ms/10000ms deadlines and all budgets are unchanged.
Target remains ECMA-262 edition16 / ECMA-402 edition12 and existing explicit extension
pins; Test262 remains419d3e0a2273ba01a3bfcbec423f2801425b8e93. The host-guard exclusion
is distinct from a language-level executing-generator TypeError; authority is not widened.

This commit is an independently revalidated delivery of the earlier recorded repair,
not a new whole-category pass. The preceding complete focused replay has205 nonpasses;
these six repairs reduce residual accounting to199, before proposal/boundary disposition.
Remaining cases, other-owner and full runtime/recovery/artifact gates stay open. A
source-changing build/report overlap from the previous debugger audit was retained as
aborted, not counted as passing. Local commits, remote ancestry and actual publications
are reported separately in the final delivery ledger.

Maintained `npm run build:workspaces -- --workspace=@poe-code/safe-js` passes with
eight built-import checks. Built SDK original, three pending and completed replay
controls pass Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,
24.14.0/78.2,26.8.2/78.3 and Bun1.3.11/74.2 (`runtime-sdk.json`). These bounded
cells do not replace Workerd or full runtime qualification. The CLI screenshot was
captured with `npx tsx scripts/screenshot.ts --output docs/plans/qualify-language-semantics/reentry-delivery/cli.png node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/reentry-delivery/smoke.ajs` and inspected: clear success output
`["TypeError",7]`, matching SDK. Dependencies are shared with the preserved workspace;
a fresh install was blocked by filesystem capacity and is not claimed.
