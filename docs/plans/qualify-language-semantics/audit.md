# Language semantics qualification — 2026-09-13

Acceptance is **open**. This is a bounded current-source audit and one atomic
repair, not a complete language qualification or a release receipt.

## Source, contract and evidence reconciliation

Inspected repository AGENTS.md; no ancestor or nested applicable AGENTS.md was
present. Local main: `53f5e1598471b8c0281b9490732b2b5a6dc45342` with preserved
working changes. `git ls-remote origin refs/heads/main` observed remote main
`49ed651876290182ab1ecb87dffaf8581c0011a6`. Those sources differ; local results
do not certify remote main. Node 22.23.2, ICU 78.2, V8
12.4.254.21-node.56, Darwin arm64. [Initial file hashes](environment-before.json)
also retain the original staged-diff hash and full Node component versions.

The target remains ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), plus
the separately pinned extensions in the parent ledger. Test262 remains
`419d3e0a2273ba01a3bfcbec423f2801425b8e93` at
`/tmp/safejs-baseline-test262-419d3e0`. No floating specification or native-engine
behavior replaces that contract.

[Evidence verification](evidence-verification.json) independently hashes the
complete V4 manifest, aggregate and mismatch inventory; all three match the
recorded independent final crosscheck. This verifies those historical bytes,
not current conformance. The focused lexical candidate's file hashes and the
generator-reentry repair hash are compared separately. Earlier passes are not
adopted across changed source. The async and error audit receipts describe
different source fingerprints; their successful publication or focused checks
do not close the current category ledger.

The V4 inventory assigns 334 failing variants directly to this task. Their
original fixture hashes match the pinned checkout. Deduplicating their files
and recorded passing neighbors gives 312 files, selected by the literal
[maintained command](command.json). No complete suite was repeated.

[Current report](current-primary.jsonl), source-content SHA-256
`bf15c0d8483baabebfa9204d14c0abc95612ce85ca0f0997cbb9d20708aff92f`, completed
14:36:48–14:37:16 UTC: **531 variants, 321 passed, 210 failed, zero unsupported,
metadata errors or execution errors**, exit 1. Of the 334 original failures,
124 now pass and 210 still fail. All 197 additional variants pass.
[Per-case reconciliation](primary-reconciliation.json) preserves each owner,
clause/esid, original hash/mode, actual diagnostics and neighboring control.
No pass is inferred for categories owned by resource, module, async, error,
environment or other focused tasks.

## LANG-EVAL-DELETED-GLOBAL — repaired locally

Primary owner: `qualify-language-semantics`, Annex B eval-code semantics.
Contract: [ECMA-262 2025 B.3.2.3](https://tc39.es/ecma262/2025/multipage/additional-ecmascript-features-for-web-browsers.html#sec-web-compat-evaldeclarationinstantiation)
and [global/object Environment Record SetMutableBinding](https://tc39.es/ecma262/2025/multipage/executable-code-and-execution-contexts.html#sec-global-environment-records-setmutablebinding-n-v-s).
The legacy block declaration writes to the variable environment with strictness
false. Deleting its configurable global property does not turn this operation
into an unresolvable-reference assignment.

Small counterexample, in an ordinary sloppy Script:

```js
eval("delete globalThis.f; { function f(){return 7} }");
f();
```

Expected: 7, with a recreated writable/enumerable/configurable global property.
Actual before repair: runtime ReferenceError, `Cannot assign to undeclared
binding 'f'.` Neighbor: omit the deletion, yielding 7. Strict eval keeps the
block function local. If the global becomes nonextensible after deletion,
the non-strict write fails silently and the function remains absent.

The independently written regression first produced **three failures and two
passing controls**, 113 ms test time / 1.90 s process duration, before editing
runtime code ([red log](eval-deleted-red.log)). Command:

```sh
npx vitest run packages/safe-js/test/conformance/eval-deleted-global-function.test.ts
```

`Scope.assignVar` now uses the supplied guest property-write operation directly
on the global object environment. Local variable environments retain their
existing path. The callback remains responsible for guest setters, prototype
semantics, budgets and non-strict write behavior; no native evaluation or host
authority is introduced. No budgets, assertions, runtime support or deadlines
were relaxed.

[Original-context rerun](eval-deleted-upstream.jsonl), using the
[literal command](eval-deleted-command.json), completes with **32/32 passing**:
all 16 original failures and their 16 original controls, unchanged upstream
fixture bytes and modes. Source-content SHA-256:
`cf39e27cad20f48d692112ad30c758a994af65d0ac7ce16eb9f507f3282a444a`.
Per-variant timeout remains 3000 ms, worker startup allowance 10000 ms; no
budget override. Later changes only improve the new regression's integration
coverage and rebuild maintained artifacts; the repaired scope code is unchanged.

Final [focused check](eval-deleted-final-focused.log): **80 tests / seven files
passed**, zero skips, 6.10 s. It includes scope, global declarations/setters,
deleted local bindings, dynamic functions, eval source ownership and replay.
The new regression exercises three dump/restore cycles across suspension plus
completed replay, two separate eval source environments, and constructor-chain
checks for absent ambient process/require authority. Those are bounded escape
controls, not a whole sandbox security certification.

An initial integration expectation incorrectly required lint to accept bare
names introduced by eval and absent host globals. It failed with six AS003
diagnostics ([log](eval-deleted-replay.log)). The executable integration example
now uses explicit `globalThis` property access and passes lint. The public
README states that lint success is not runtime compatibility proof; no contract
was found requiring lint to infer eval-created bindings. This is an observed
lint/runtime distinction, not a repaired ECMAScript defect.

Targeted ESLint passes. The maintained selected build
`npm run build:workspaces -- --workspace=@poe-code/safe-js` passes, including
eight native built-import checks ([build log](eval-deleted-build.log)). Built
[SDK result](eval-deleted-sdk.json) and [CLI result](eval-deleted-cli.log) both
return `[8,9,"undefined"]` for [the same source](eval-deleted-smoke.ajs).
CLI command:

```sh
node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/eval-deleted-smoke.ajs
```

No CLI rendering or visual-language code changed. A later combined-source
[screenshot](eval-deleted-cli.png) was captured with the maintained screenshot
script and visually inspected: the complete command and successful JSON result
are readable. This is bounded behavioral/visual parity, not complete CLI certification. No full package/repository gate,
full supported-runtime matrix or installed-release claim is made.

## Remaining scope and delivery

After the isolated 16-case repair, **194 of the original primary-owner failures
remain unresolved**; the 312-file selection has not been rerun wholesale after
the repair. These include 38 decorators-proposal rows and 20 resource-management
extension rows, retained as explicit nonpasses with separate edition/extension
qualification. Decorators are not silently added to ES2025 or counted as passes.
The remaining semantic diagnostics include Annex B assignment targets and
arguments, destructuring reference/coercion order, eval binding deletion,
async/generator creation, grammar/early-error and regexp statement boundaries,
scope/with behavior, and primitive assignment. The exact per-case evidence is
in the reconciliation. Each needs primary-contract validation and an independent
minimal regression before a repair. Resource-owned tail-call/deadline cases and
other category owners' unresolved cases still need reconciliation as well.

Full category closure, adversarial/recovery and runtime-matrix qualification,
remote delivery and release verification are outstanding. Local commits,
remote-main ancestry and publication must be reported separately; previous
tasks' release receipts do not publish this repair. No push or release has
occurred in this execution at the time of this receipt.
