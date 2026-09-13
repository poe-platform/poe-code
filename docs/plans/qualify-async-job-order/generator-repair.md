# Async-generator return assimilation repair

Owner: `qualify-async-job-order`; recovery coordination: `qualify-realms-and-recovery`.

ECMA-262 edition 16 (June 2025), AsyncGeneratorStart, AsyncGeneratorUnwrapYieldResumption and delegated YieldExpression evaluation govern this repair. A body return or return resumption has already awaited its value. A return into an unstarted/completed generator bypasses that body and still requires AsyncGeneratorAwaitReturn. Delegation with no `return` method has an additional await at that missing-method step.

On source `bc6107ba5a308e94335f2d419d51d122ed17e6c3` plus the fingerprinted existing worktree, Node 22.23.2 / ICU 78.2, a getter returning undefined was read twice by both a body return and a queued `.return`. The smallest body counterexample is `async function* f(){return value}`, with `value={get then(){reads++}}`. The expected read count is one. Unstarted and completed generator returns are neighboring passing controls.

TDD command: `npx vitest run packages/safe-js/test/async-generator-return-order.test.ts`. The initial independent ordering regression failed in 113 ms; expanded controls had three failures/two passes in 261 ms. The pinned Test262 `language/statements/async-generator/yield-return-then-getter-ticks.js`, revision `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, independently failed both variants.

Restricting the driver await exposed the delegated missing-return case's dependence on that misplaced await. A new failing ordering control required two getter reads, with `get return` between them. The final change moves that second await into delegation, represents its pending phase, and validates both continuation fields and source position. Direct pending restoration and malformed-state rejection tests cover the new phase. No budget or deadline changes are needed.

The final focused qualification command, recorded in `commands.md`, passes 132 tests across 12 files. Both pinned generator tick fixtures pass. Nine literal traces also agree in original/pending/completed execution across Node 18.18/18.20/20/22/24/26 and Bun; Workerd passes the original traces. Native Node18/Bun differ on the delegated control, while SafeJS agrees with the published 2025 algorithm. Full-suite and delivery receipts belong to `safejs-gap-closure-evidence.md`; no publication is implied by this plan.
