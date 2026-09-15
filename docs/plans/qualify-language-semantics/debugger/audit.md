# Debugger statement qualification — 2026-09-13

LANG-DEBUGGER-STATEMENT repairs the two original strict/sloppy failures for
`language/statements/debugger/statement.js`. Whole-task acceptance remains open.
Parent main: `4cf2a5893fa6f6f8ad09e070a13bb74466a833bb`; fetched remote:
`49ed651876290182ab1ecb87dffaf8581c0011a6`. Node22.23.2 / ICU78.2, Darwin arm64.
The published ECMA-262 edition16 / ECMA-402 edition12 target, explicit extensions,
and Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93 are unchanged.

Rehashed the complete V4 manifest, aggregate and mismatch inventory against the
original receipts: all three match (`initial.json`). These historical failures
remain historical; previous repairs are not presumed current. The selected fixture
and its recorded expression-position negative control retain their original hashes.

`while(false) debugger;` incorrectly throws ParseError. ECMA-2622025 §14.16 allows
this statement; §14.16.1 specifies empty completion when no debugging facility is
enabled. Read the published clause at
https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-debugger-statement
using curl after the whole-edition web fetch exceeded the reader size limit.
The parser now accepts literal debugger in statement positions and lowers it to the
existing empty-completion node with the original source span. It consumes its
semicolon or enforces ASI. No debugger capability or other host authority is exposed.

Independent regression before repair: **11 failed / seven passed** (`red.log`).
The first narrow edit left the separate top-level dispatcher unhandled:
**six failed /12 passed** (`green.log`). Adding debugger to that existing dispatcher
makes **18/18 pass** (`green-final.log`), with unchanged assertions. Controls reject
expression, escaped-keyword, binding, label and missing-semicolon forms. Integration
covers direct/indirect eval, dynamic functions, generator source identity, finally,
three pending checkpoint/replay cycles, completed replay and constructor host-escape
controls. The source string is retained verbatim through saved function provenance.

Manual checks:

```sh
npx vitest run packages/safe-js/src/parse/debugger-statements.test.ts packages/safe-js/src/parse/statement-body-declarations.test.ts packages/safe-js/src/parse/sloppy-let-statement-bodies.test.ts packages/safe-js/src/parse/eval-script.test.ts packages/safe-js/src/parse/lexical-statement-terminators.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/debugger-statements.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

**105 tests/five files pass**, zero skips; scoped lint and maintained build pass,
including eight built-import checks. Original upstream contexts use the literal
`command.json`: **two files/four variants/four passes**, zero failures, unsupported,
metadata or execution errors. `reconciliation.json` records exact source fingerprint,
Node/ICU, unchanged 3000ms/10000ms deadlines, fixture hashes and terminal counts.
No complete suite was repeated. No budget, assertion, timeout or runtime was weakened.

Built SDK/eval/replay/host-isolation and unchanged 100-step loop rejection pass on
Node18.18.0/ICU73.2,18.20.8/74.2,20.20.0/77.1,22.23.2/78.2,24.14.0/78.2,
26.8.2/78.3 and Bun1.3.11/74.2. `runtime-sdk.json` retains every executable argument
vector and parsed result. These are bounded SDK checks, not Workerd or full alternate
runtime corpus qualification. Built CLI screenshot inspected: legible success JSON
`[42,7]`, matching SDK semantics. Command and source are in `qa.md` and `smoke.ajs`.

Remaining historical accounting after this repair: **161 primary nonpasses** and
**126 secondary resource nonpasses**, before explicit edition/proposal dispositions.
This is a residual count from recorded per-case repairs, not a fresh complete run.
Other-owner, complete runtime/recovery/artifact and publication gates remain open.
Local commit, verified remote-main delivery and actual publication are separate;
no push/publication is claimed by this local repair receipt. Delivery is being
reconciled in a detached checkout of fetched remote main, preserving local work.
