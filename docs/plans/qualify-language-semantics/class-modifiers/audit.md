# Class modifier spellings — 2026-09-13

LANG-CLASS-MODIFIER-SPELLING repairs six recorded primary-owner failures. Whole-task
acceptance remains incomplete. Candidate parent is
`7d645b4cb6261dba2d3cbf06208efd800fc8b989` with preserved working changes; the
conformance runner records source fingerprint
`a1eb3c4500fdcdc38e5ab4a3968da0af57a5c84e5096ec236760540ef64b424f`.
Node 22.23.2 / ICU 78.2, Darwin arm64. The compatibility target remains published
ECMA-262 edition 16 / ECMA-402 edition 12 and the ledger's separate extension pins.

The complete V4 manifest, aggregate and inventory were independently byte-verified
against `independent-final-crosscheck.json`; [hashes](historical-integrity.json).
The six original strict/sloppy failures are `async-meth-escaped-async.js`,
`async-gen-meth-escaped-async.js` and `syntax/escaped-static.js` under
`language/statements/class`. Their recorded two neighboring controls are reused.
No whole historical category suite was repeated or presumed passed.

The pinned [grammar-notation contract](https://tc39.es/ecma262/2025/multipage/notational-conventions.html#sec-grammar-notation)
requires literal grammar terminals. Escaped spellings may instead form ordinary
property names. Minimal counterexample: `class C { \u0061sync m() {} }` was accepted
rather than rejected before execution. An independent valid-program counterexample
uses `st\u0061tic` followed by a newline and `m(){}`: the parser incorrectly creates
a static method instead of an instance field and instance method.

TDD: [red.log](red.log) records **9 failed / 6 passed** before the repair. The
[patch](repair.patch) adds raw-spelling length checks only at the two existing
class modifier recognition points. A Unicode escape always occupies more source
code units than the decoded contextual keyword. Escaped names fall through to
ordinary class field/method parsing; blanket rejection would break valid ASI.
No tokenizer, runtime, snapshot, authority or budget behavior is broadened.

Final focused validation is **96 passed / zero failed or skipped**, four files.
[Focused log](focused.log), [lint](lint.log), [maintained build](build.log) all exit 0;
the build's eight built-import checks pass. Exact commands:

```sh
npx vitest run packages/safe-js/src/parse/class-modifier-spellings.test.ts
npx vitest run packages/safe-js/src/parse/class-modifier-spellings.test.ts packages/safe-js/src/parse/classes.test.ts packages/safe-js/src/parse/private-classes.test.ts packages/safe-js/src/parse/escaped-keywords.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/class-modifier-spellings.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

Tests cover strict/sloppy Script parsing, module parsing and lint rejection;
ordinary escaped fields/methods, private names, valid async/generator/static methods,
computed/private invalid modifiers and ASI. Direct/indirect eval and Function reject
before marker writes; SyntaxError identity and finally behavior survive three
pending checkpoint/replay cycles and completed replay. A valid private class
retains its source and value after failed compilation. Constructor-chain process
and require access and ambient fetch remain absent.

[Manual QA](qa.md) was executed. The built CLI exits 2 at line 1, column 22, matching
SDK ParseError. The [actual screenshot](cli.png) was inspected: readable diagnostic
and caret at the unexpected `m`. The unrelated trailing-newline caret issue stays
open. Explicit maxSteps=100 rejects the independent guest loop with
`budgetExceeded` / `steps`; no timeout, budget, assertion or support setting changed.

Built SDK runtime commands and full outputs are saved in
[runtime-sdk.json](runtime-sdk.json). Six available Node binaries pass native parse
rejection, SDK diagnostics, original and repeated replay, host-negative and budget
controls. Exact runtime/ICU versions are retained, rather than substituting a
runtime's claimed major for its actual binary. Bun's first combined probe exits 1:
its `vm.Script` constructor defers parsing, while all SafeJS controls already pass.
Executing `runInNewContext()` forces the native comparison; the
[unchanged guest recheck](bun-native-recheck.json) exits 0. This is a native probe
limitation, not a weakened assertion or a SafeJS semantic defect. The original
failed observation is preserved.

The initial Node 18.18 `--import tsx` upstream invocation exits 1 before enumeration:
unknown `.ts` extension. The maintained tsx CLI selects the legacy loader on that
runtime; its separate original-context retry and exit are retained. The failed
loader invocation contributes no passes. No production runtime minimum was raised.

See [command.json](command.json) for the literal maintained upstream command and
[upstream.jsonl](upstream.jsonl) for **10/10 passing variants**, complete, exit 0.
All six original failures and four controls retain their original fixture hashes,
strict/sloppy variants, assertions, 3000 ms deadline and 10000 ms startup allowance.
Runtime-specific upstream commands, outcomes and reconciliation are separate receipts.

Unverified: Workerd guest execution/replay, exact ledger N20=20.20.2 and
N24=24.21.0 cells (available probes use 20.20.0 and 24.14.0), installed published
artifacts, full category-to-owner reconciliation and full task acceptance.
The prior residual **179** primary nonpasses minus these six leaves **173**
historical unresolved rows before edition/extension dispositions; this is not a
fresh whole-selection count. The **126** secondary resource nonpasses remain open.
Proposal/extension rows and unavailable cells are neither discarded nor passes.
No full package or repository-wide gate is claimed for this focused parser repair.

Local commit, verified remote-main delivery and successful release are separate.
No push or publication has been performed for this repair; no release receipt is
claimed from another task. Unrelated local and staged changes are preserved.

## Terminal runtime accounting

Mapped upstream results: **10/10 variants on each of six Node runtimes**:
18.18.0/ICU73.2, 18.20.8/74.2, 20.20.0/77.1, 22.23.2/78.2, 24.14.0/78.2,
26.8.2/78.3. Each is independently hash/mode reconciled to V4 in
[reconciliation.json](reconciliation.json); all share the candidate source fingerprint.
Bun 1.3.11/ICU74.2 passes the built SDK checks after forcing its native lazy parse,
but has no mapped upstream runner execution. Workerd remains unexecuted.

The first Node26 upstream attempt emitted ten passing result rows, then aborted
while finalizing the report: **ENOSPC**, complete:false, exit1. It remains an
incomplete run, not a pass. The outer receipt writer also hit ENOSPC; its literal
argument vectors and observed exits were reconstructed from the unchanged loop.
Disk observation showed 172MiB available. No unrelated data was removed. After
space recovered, a new report path and unchanged command/budgets produced a
complete **10 passed / zero failed or unsupported**, exit0. The original aborted
report and the separate [retry command](node26-retry-command.json) remain retained.
This is resource evidence, not an ECMAScript defect or a timeout adjustment.

The additional ledger section and tests do not modify runtime provenance. The
[repair patch](repair.patch) is the complete owned production diff.
