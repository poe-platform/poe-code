# LANG-EVAL-VAR-NO-INIT

Primary owner: `qualify-language-semantics`, eval-code and variable-statement
semantics. This is a second atomic repair; global block-function recreation is
separately committed as `eece392d0ee622f2c460f3a1cfec6ae752b02a63`.

The contract is [ECMA-262 2025 §14.3.2.1](https://tc39.es/ecma262/2025/multipage/ecmascript-language-statements-and-declarations.html#sec-variable-statement-runtime-semantics-evaluation):
a `var` declaration without an initializer returns an empty completion. Its
binding is created by declaration instantiation, not by evaluating the statement.

Minimal source in sloppy Script/function context:

```js
(function () {
  eval("delete x; var x;");
})();
Object.hasOwn(globalThis, "x");
```

Expected: false. Actual before repair: true. A saved closure reading `x` also
wrongly returns undefined rather than throwing ReferenceError. An ordinary
`var x;` hoisting control and `delete x; var x=7;` initialized-assignment control
both already pass. The latter intentionally creates a global through a sloppy
unresolvable assignment; that behavior must remain distinct from no initializer.

At parent source `eece392d0ee622f2c460f3a1cfec6ae752b02a63` with preserved
working changes, the independent [regression](../../../packages/safe-js/test/conformance/eval-deleted-var.test.ts)
first produces **two failures / two passing controls**, 133 ms test time,
2.37 s command duration ([red log](eval-var-red.log)). Node 22.23.2 / ICU 78.2,
V8 12.4.254.21-node.56, Darwin arm64. It covers an ordinary var statement and
a for-loop initializer. Command:

```sh
npx vitest run packages/safe-js/test/conformance/eval-deleted-var.test.ts
```

The [repair](eval-var-repair.patch) removes the binding-exists condition from
the existing no-initializer fast path. It avoids a spurious lookup and write;
declaration instantiation and initialized declarations are unchanged. No new
function, flag, host access or optional fallback is introduced.

The unchanged pinned original `language/eval-code/direct/var-env-var-init-local-new-delete.js`
and its ledger-recorded neighboring control both pass in the maintained runner:
**two files / two variants / two passed / zero failed, unsupported or accounting
errors**, exit 0 ([report](eval-var-upstream.jsonl), [command](eval-var-command.json)).
Source-content SHA-256 is
`e49bf844a7ac184daab8648d492db93a058fdecd8b196bc76ad093b600ed5c2a`.
The 3000 ms variant and 10000 ms startup limits remain unchanged.

Final [focused selection](eval-var-final.log): **78 tests / seven files passed**,
zero skips, 5.81 s. [Additional var/hoisting/parser/replay neighbors](eval-var-neighbors.log):
**70 tests / five files passed**, zero skips, 3.87 s. Counts are selections, not
a full package total. Three consecutive suspension/dump/restore cycles and
completed replay retain the absent binding and closure ReferenceError.
Targeted ESLint passes. The maintained selected workspace build passes, including
eight native built-import tests ([build](eval-var-build.log)).

[Built runtime controls](eval-var-runtime.json) pass original and completed
replay on Node 18.18.0 / ICU 73.2, Node 22.23.2 / ICU 78.2 and Node 24.14.0 /
ICU 78.2. This is bounded runtime coverage, not a complete support-matrix gate.
The [built CLI](eval-var-cli.log) returns the same `["ReferenceError",false]`
for [the same source](eval-var-smoke.ajs):

```sh
node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/eval-var-smoke.ajs
```

[Native controls](native-controls.json) agree for both repaired counterexamples.
They are controls only; the published clauses determine the expected behavior.
No CLI presentation code changed. The maintained screenshot script captured
[the CLI result](eval-var-cli.png); visual inspection confirms a readable complete
command and the expected successful JSON result.

This fixes one additional original primary-owner failure. **193 earlier
primary-owner nonpasses remain unresolved**, including the recorded proposal and
extension rows. They are not converted to passes by subtracting this repair;
the full earlier selection has not been rerun wholesale on this source.
Secondary resource-owner evidence is recorded separately. Task acceptance,
remote delivery and publication remain open.
