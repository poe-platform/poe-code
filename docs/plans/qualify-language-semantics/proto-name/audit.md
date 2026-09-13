# Prototype setter function names — 2026-09-13

LANG-PROTO-SETTER-NAME is repaired locally. Whole-task acceptance remains open.
Source parent: `440805b703b1339c9240077e129c8607ed6f51f5`, with preserved working
changes. Runtime: Node 22.23.2 / ICU 78.2, Darwin arm64. Target remains ECMA-262
edition 16 / ECMA-402 edition 12 and the separately pinned extensions.

The complete V4 manifest, aggregate and independent mismatch inventory were
hashed against the earlier evidence-verification receipt; all three match.
No other focused audit is presumed to pass on this source. The existing primary
reconciliation supplies the two strict/sloppy `__proto__-fn-name.js` failures,
original fixture hash and computed-property passing neighbors. The corpus
checkout is clean at `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.

Contract: [ECMA-262 2025 PropertyDefinitionEvaluation](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-object-initializer-runtime-semantics-propertydefinitionevaluation).
Prototype setters evaluate anonymous definitions without property-name inference.
Minimal independent counterexample:

```js
Object.getPrototypeOf({__proto__: function () {}}).name
```

Expected empty string; before repair, `"__proto__"`. The independently written
regression produced **six failures / five passing controls** before the runtime
edit ([red.log](red.log)). It covers ordinary/arrow/async/generator/async-generator
functions and classes. Named definitions, computed data properties, methods and
accessors are controls. The existing prototype-setter predicate now gates name
inference; no new abstraction or host call is added ([repair.patch](repair.patch)).

Commands, all from repository root:

```sh
npx vitest run packages/safe-js/test/conformance/prototype-setter-function-name.test.ts
npx vitest run packages/safe-js/test/conformance/prototype-setter-function-name.test.ts packages/safe-js/src/interp/anonymous-function-names.test.ts packages/safe-js/src/interp/object-literal-realm.test.ts packages/safe-js/src/snapshot/null-object-prototype.test.ts
npx eslint packages/safe-js/src/interp/interpreter.ts packages/safe-js/test/conformance/prototype-setter-function-name.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
npx tsx scripts/screenshot.ts node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/proto-name/smoke.ajs
```

Final focused result: **69 passed / zero failed or skipped**, four files, exit 0
([focused.log](focused.log)). Integration coverage includes lint acceptance,
separate eval/dynamic-function closure state, saved exact function source,
three pending checkpoint/replay cycles and completed replay. Constructor-chain
probes confirm absent ambient process/require authority. These are bounded
controls, not complete security or runtime-matrix qualification.

Targeted lint and maintained build pass; build includes eight built-import checks.
The built SDK and CLI both return `["",7,"undefined"]` for [smoke.ajs](smoke.ajs).
The maintained screenshot renderer's [CLI image](cli.png) was visually inspected:
the command and complete result are legible. No visual-language changes.

[Literal upstream command](command.json), [terminal report](upstream.jsonl):
**four files / eight variants / eight passed / zero failed, unsupported, metadata
or execution errors**, complete, exit 0. Both original failures retain their
fixture hashes and original strict/sloppy execution contexts. Source fingerprint
`6d7241b0709b644d476025b01438edf68c340438488b19e7fceae829d28a7049`.
No deadline, budget, assertion, runtime-support or isolation change was made.

Review found no new proxy functions, duplicated logic, host authority, ownership
or snapshot-format changes. Existing abrupt-completion and retained-key cleanup
paths are unchanged. [Preservation receipt](preservation.json) verifies only this
owned runtime change among pre-existing SafeJS modifications and unchanged staging.

Remaining: 181 prior primary nonpasses before edition/extension disposition,
126 previously reproduced secondary resource nonpasses, other-owner evidence
reconciliation, runtime/artifact gates and the prior caret-placement finding.
These are historical remaining counts, not a fresh aggregate-source pass.
Duplicate prototype-setter early errors remain a separate unresolved defect.
No full suite was repeated. No push was requested or performed, no verified
remote-main delivery or publication receipt exists for this repair.
