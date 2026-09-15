# Parenthesized destructuring assignment targets — 2026-09-13

LANG-PARENTHESIZED-PATTERN repairs six original language-owner variants. Whole-task
acceptance remains incomplete. Base main SHA:
`54c62cb3176dcfc0f6761321ba2ae8f2d011f4f6`; Node 22.23.2 / ICU 78.2,
Darwin arm64. The published target remains ECMA-262 edition 16 / ECMA-402 edition
12 and the existing explicit extension pins. Test262 remains
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

The complete V4 manifest, aggregate and mismatch inventory were independently
SHA-256 checked against the preceding recorded integrity receipt; all three match:
`c8b428444f7854afcba72fe3bfebcf9b9390dfe2a9714b1c2da36794a6e43617`,
`d066be16ae8bafa10ba81222f0b7a53a09e42e8228f1c3d08e8ad9c14d01ba48`,
`9b196c676c2ce180e48a4ec9677565e1b4bc3bcbd217651ec88d2807521e70ad`.
No earlier task is adopted as passing on this source.

The independent counterexample `({}) = 1;` was accepted. So were parenthesized
arrays and the same object syntax in ordinary/async arrow bodies. Invalid eval
source `globalThis.marker=1; ({})=1;` actually wrote the marker. Under the
[edition 16 assignment early errors](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-assignment-operators-static-semantics-early-errors),
parenthesized literals cannot become destructuring patterns. The repair checks
existing parenthesis metadata only at array/object expression-to-target conversion.
Grouped simple references and parentheses around a whole assignment remain valid.

TDD produced **7 failed / 8 passed** before the two-line repair. Final focused
checks pass **195 tests / 10 files**, zero failed/skipped. This covers strict/sloppy
Script, module grammar, lint acceptance, direct/indirect eval and dynamic Function
SyntaxError identity before side effects, finally, saved eval function source,
three pending checkpoint/replay cycles, completed replay and denied ambient
process/require through constructor chains. A 100-step loop still rejects with
budgetExceeded/steps. No runtime, authority, budget, timeout or assertion was weakened.

Manual commands (from repository root):

```sh
npx vitest run packages/safe-js/src/parse/parenthesized-pattern-targets.test.ts
npx vitest run packages/safe-js/src/parse/parenthesized-pattern-targets.test.ts packages/safe-js/src/parse/literal-member-assignment-targets.test.ts packages/safe-js/src/parse/object-rest-assignment.test.ts packages/safe-js/src/parse/new-target-spelling.test.ts
npx vitest run packages/safe-js/src/interp/patterns.test.ts packages/safe-js/src/interp/destructuring-iterator.test.ts packages/safe-js/src/interp/destructuring-order.test.ts packages/safe-js/src/snapshot/guest-generator-array-patterns.test.ts packages/safe-js/src/snapshot/guest-generator-object-patterns.test.ts packages/safe-js/src/snapshot/guest-generator-assignments.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/parenthesized-pattern-targets.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

All final commands exit 0; the maintained build includes **8 passing built-import
checks**. No full package or repository-wide gate is claimed. CLI screenshot QA
was executed with `npx tsx scripts/screenshot.ts --output <PNG> node
packages/safe-js/dist/cli.js <invalid.ajs>` using the exact nine-byte counterexample
above without a trailing newline. Actual CLI exit 2 displays ParseError, line 1 /
column 1 and `Invalid assignment target at line 1, column 1.`; SDK agrees. The
screenshot was inspected: source line and caret are legible and correctly aligned.
The separately recorded trailing-newline caret issue is not closed here.

Built SDK/replay/native controls pass on Node **18.18.0 / ICU73.2**, **18.20.8 /
74.2**, **20.20.0 / 77.1**, **22.23.2 / 78.2**, **24.14.0 / 78.2**, **26.8.2 /
78.3** and **Bun1.3.11 / ICU74.2**. Bun initially reports the native vm.Script
constructor as accepted because compilation is lazy; invoking runInNewContext
forces compilation and then rejects with SyntaxError. That initial failed probe
is retained separately; production and expected outcomes were not changed.
These SDK probes do not certify upstream corpus execution on alternate runtimes.
Workerd, the exact missing Node20/24 patch cells and installed artifacts remain open.

Original upstream execution reuses exactly these files under
`language/expressions/assignmenttargettype/`:

- `direct-arrowfunction-1.js`, control `direct-arrowfunction-0.js`;
- `direct-asyncarrowfunction-1.js`, control `direct-asyncarrowfunction-0.js`;
- `parenthesized-primaryexpression-objectliteral.js`, control
  `parenthesized-primaryexpression-literal-string.js`.

Run `node --import tsx packages/safe-js/test/conformance/command.ts --corpus
/tmp/safejs-baseline-test262-419d3e0 --report <new-report.jsonl>` with one
`--include <full-path>` for each file. The complete terminal report has **6 files /
12 variants / 12 passed / zero failed, unsupported, metadata or execution errors**,
exit0. The first attempt aborted with `Runner sources changed during enumeration`
because the overlapping build refreshed dist; it is not a pass. The unchanged
selection was rerun after the build ended. Original **3000ms variant / 10000ms
startup** deadlines and harness assertions remain intact.

[Reconciliation report](reconciliation.json) retains exact fixture hashes, modes,
original failures, controls, source fingerprints and complete terminal summaries.
Working-source fingerprint is
`01b0e485d46d69b5a4f60828bf6ba1739aba46e0385eca3a57c614d23e92c425`.
The independent clean candidate (HEAD plus only this patch/test) passes the same
**195 tests**, scoped lint and all **12 original upstream variants**. Its source
fingerprint is `46d62690dbdb1771167352bc78bcce3a4a8449554f89980d5ae65be801be9671`.
The report records exact committed parser/test byte hashes; other working repairs
are absent from this candidate. Its shared dependency installation is recorded,
not presented as a fresh install or installed-artifact gate. Isolated setup attempts
initially lacked root tests, root src, generated Intl data and the lint root-link
receipt. These failures remain recorded; extracting the original setup inputs and
running `node packages/safe-js/scripts/numberformat-data.mjs` restored prerequisites
without changing lint, assertions, tests or runtime code.

Local logs, complete raw reports, screenshot and command receipts remain in this
same evidence directory as review artifacts. The commit contains the owned source,
regression, audit/QA and reconciliation report; it does not adopt unrelated staged
changes or generated artifacts. Local SHA is reported after commit. No task push,
verified remote-main delivery or release/publication has occurred.

Remaining: **165 historical primary nonpasses**, before edition/extension
classification, **126 secondary resource nonpasses**, other-owner reconciliation,
full runtime/recovery/artifact gates and the prior caret issue. These are historical
residual counts, not a newly executed whole-selection report. Exclusions and
unavailable cells remain visible nonpasses. This atomic repair is not whole-task
acceptance.
