# let / await / yield declaration lookahead — 2026-09-13

LANG-LET-CONTEXTUAL-LOOKAHEAD repairs two original sloppy Script failures. Whole-task
acceptance remains incomplete. Parent main SHA
`8aecabb27604bec0f166a50c44ef186c8561eff6`; Node **22.23.2 / ICU78.2**, Darwin arm64.
Published ECMA-262 edition16 / ECMA-402 edition12, existing explicit extension pins,
and Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93` remain unchanged. The preceding
parenthesized-pattern audit independently verified the complete V4 report hashes
in this same session; this repair reuses its exact report and recorded cases.

Minimal independent counterexamples:

```js
async function f() { let
  await 0;
}
function* f() { let
  yield 0;
}
```

Both were incorrectly accepted by sloppy Script parsing. Lexical-declaration
lookahead was using the contextual identifier _acceptance_ rule, excluding await
or yield in contexts where their bindings are forbidden. It therefore inserted
ASI after let. The [published declaration grammar](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-let-and-const-declarations)
requires recognizing the declaration before enforcing those early errors. The
repair admits keyword/escaped-keyword await and yield into this existing lookahead;
normal binding validation then rejects them. String literals are deliberately not
matched by their value. Statement-only let expressions retain their existing rule.

Before repair, **nine syntax/dynamic-function regressions fail**, six controls pass,
and the replay probe also fails for an incorrectly authored strict-eval fixture
(**10 failed / 6 passed** overall). After repairing syntax, only that replay probe
still failed: direct eval inherited the strict public execution context, so its
`var let` fixture was invalid. The corrected probe explicitly uses a sloppy dynamic
Function's direct eval and indirect eval for the saved generator. This is a test
context correction, not relaxed assertions or a production strictness change.
The final unchanged expectations require SyntaxError identity, no marker writes,
finally completion, generator value/done state, saved source, three pending replay
cycles, completed replay and absent ambient process/require through constructors.

Final manual checks pass **74 tests / five files**, zero failed/skipped. The same
checks pass in the independent HEAD-plus-owned-patch candidate. Exact commands:

```sh
npx vitest run packages/safe-js/src/parse/let-await-yield-lookahead.test.ts
npx vitest run packages/safe-js/src/parse/let-await-yield-lookahead.test.ts packages/safe-js/src/parse/sloppy-let-statements.test.ts packages/safe-js/src/parse/sloppy-let-statement-bodies.test.ts packages/safe-js/src/parse/for-of-let-lookahead.test.ts packages/safe-js/src/parse/parenthesized-pattern-targets.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/let-await-yield-lookahead.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

The maintained working build passes, including **eight built-import checks**.
Scoped lint on the exact clean candidate parser/test bytes passes; their SHA-256
hashes are in the [reconciliation report](reconciliation.json). The candidate
reuses the preceding audit's isolated source tree, which equals this parent HEAD
for runtime code, plus only this patch/regression. No unrelated worktree source
change is incorporated into its checked parser. Shared installed dependencies
are not represented as a clean install or publication gate. No full package or
repository-wide suite is claimed.

Original upstream contexts use exactly four files:

- `language/statements/async-function/let-newline-await-in-async-function.js`;
- recorded control `language/statements/async-function/evaluation-unmapped-arguments.js`;
- `language/statements/let/syntax/let-newline-yield-in-generator-function.js`;
- recorded control `language/statements/let/syntax/let-newline-await-in-normal-function.js`.

Command: `node --import tsx packages/safe-js/test/conformance/command.ts --corpus
/tmp/safejs-baseline-test262-419d3e0 --report <new-report.jsonl>` plus one
`--include <full-path>` per file. Both working and independent candidate runs
complete with **4 files / 8 variants / 8 passed / zero failed, unsupported,
metadata or execution errors**, exit0. The two original sloppy failures, their
strict variants and recorded controls retain original fixture bytes/modes and
harness assertions. Original **3000ms variant / 10000ms startup** deadlines remain.
Working fingerprint:
`275d60c5cc0f880176b80432b41a0ad6b7ada9bae751c8aaa26c636761bc3555`.
Clean commit-candidate fingerprint:
`4ecbfab4c180a643a4b7caf2a7ae88a13c7b7111eb1447156bd5b7613abed742`.
The reconciliation report retains exact headers, terminal summaries and row hashes.
No complete suite is repeated or inferred passing from another task.

Built SDK/native/replay/budget probes pass on Node **18.18.0/ICU73.2**,
**18.20.8/74.2**, **20.20.0/77.1**, **22.23.2/78.2**, **24.14.0/78.2**,
**26.8.2/78.3** and **Bun1.3.11/74.2**. Each checks five original/replayed outcomes
and a 100-step loop rejecting with budgetExceeded/steps. No host authority, runtime
support, timeout, budget or assertion was weakened. These SDK checks do not qualify
alternate-runtime upstream suites, missing exact patch versions, Workerd or
installed packages.

The built CLI screenshot was generated with `npx tsx scripts/screenshot.ts --output
<PNG> node packages/safe-js/dist/cli.js <invalid.ajs>` and inspected. CLI exit2 and
SDK report ParseError: `Unexpected token 'await' at line 2, column 1.`. The two-line
source and caret are legible and aligned. This public strict-source check is a
parity control, not a claim that CLI strict parsing had the sloppy-context defect.
Local logs, commands, full raw reports and PNG remain review artifacts in this
directory. The commit owns only code, regression and audit/QA/reconciliation evidence.

The preceding atomic repair is local commit
`8aecabb27604bec0f166a50c44ef186c8561eff6`. This repair receives its own local commit.
Unrelated staged diff remains byte-for-byte identical. No task push, verified
remote-main delivery or release/publication has occurred. Earlier release receipts
do not deliver either repair. Remaining blockers: **163 historical primary
nonpasses**, before edition/extension disposition; **126 secondary resource
nonpasses**; other-owner reconciliation; full runtime/recovery/artifact gates; and
the prior trailing-newline caret issue. These counts are residual historical
accounting, not a fresh whole-selection report. Exclusions are not passes.
