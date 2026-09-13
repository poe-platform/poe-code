# Annex B implicit arguments binding — 2026-09-13

Five independent regressions failed and four controls passed before repair. Function
instantiation now adds the implicit arguments binding to the names excluded from Annex B
block-function hoisting, as ECMA-262 10.2.11/B.3.2.1 require. Explicit parameters,
lexical bindings, body functions, arrows and ordinary block-function hoisting remain
covered. The existing declaration cache is preserved; arguments-object necessity is
computed by the existing function-instantiation path.

Three existing native-oracle assertions expected V8's differing legacy behavior. Their
failures are retained in green-initial.log; they now assert the explicit edition16 result.
The verified edition HTML hash is6a28f9423133ed7b7c59a40baf620c2740f12f0bc9c251042f2a85b9cc5ed713;
extracted normative clauses are saved. This does not relax the expected behavior.

Final checks pass105 tests/five files. ESLint and maintained workspace build pass,
including eight built-import checks. Commands:

```sh
npx vitest run packages/safe-js/src/interp/legacy-arguments.test.ts
npx vitest run packages/safe-js/src/interp/legacy-arguments.test.ts packages/safe-js/src/interp/globals/dynamic-block-functions.test.ts packages/safe-js/src/interp/arguments.test.ts packages/safe-js/src/interp/globals/dynamic-duplicate-block-functions.test.ts packages/safe-js/src/interp/global-script-execution.test.ts
npx eslint packages/safe-js/src/interp/legacy-block-functions.ts packages/safe-js/src/interp/async.ts packages/safe-js/src/interp/legacy-arguments.test.ts packages/safe-js/src/interp/globals/dynamic-block-functions.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
```

The original upstream failure and recorded neighbor pass (two files/two variants),
zero unsupported/metadata/execution errors. Fixture hashes/modes and exact command are
reconciled. Source base 8400587a57e734098702a652536a5c0e451e354f plus recorded patch;
fingerprint 29d6df0b56668821124271dcd9a1308fef4e5b1e66824adbfde31e10ed090f45. Test262419d3e0a2273ba01a3bfcbec423f2801425b8e93,
Node22.23.2/ICU78.2, edition16/402edition12, unchanged3000/10000ms deadlines.

Built SDK probes pass all seven recorded Node/Bun runtimes, preserving saved dynamic
source, three pending and completed replay, host constructor isolation and100-step
budget enforcement. CLI screenshot inspected and agrees with SDK. An initial probe
command had an extra closing parenthesis; its syntax failures are retained separately
and the corrected command/results are recorded. No production assertion or limit changed.

One target failure closes:91 raw residual nonpasses, provisionally49 excluded/42 target
before the separately pending resource-proposal version reconciliation. Whole-task
acceptance and publication remain open; local commit and remote delivery are separate.
