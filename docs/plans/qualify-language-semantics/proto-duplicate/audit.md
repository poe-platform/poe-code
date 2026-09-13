# Duplicate prototype setters — 2026-09-13

LANG-DUPLICATE-PROTO-SETTER is repaired locally. Whole-task acceptance remains open.
Parent source SHA `efe356f89a30c6999a91dfe199bae609052e6ff2` plus preserved working
changes. Node **22.23.2 / ICU 78.2**, Darwin arm64. ECMA-262 edition 16 / ECMA-402
edition 12 and previously pinned extensions remain the compatibility target.

The category ledger records strict/sloppy failures for
`language/expressions/object/__proto__-duplicate.js`: the engine executes the
fixture instead of rejecting it during parsing. Its recorded passing neighbor
is `__proto__-duplicate-computed.js`. Complete V4 evidence hashes were reverified
in the immediately preceding [name-inference audit](../proto-name/audit.md).

Contract: [ECMA-262 2025 §13.2.5.1](https://tc39.es/ecma262/2025/multipage/ecmascript-language-expressions.html#sec-object-initializer-static-semantics-early-errors).
Two static prototype-setter definitions in one actual object initializer are an
early error. Computed names, methods, accessors and shorthand properties do not
count as setters; object assignment/binding patterns and JSON parsing are separate.

Independent minimal counterexample: `({__proto__: null, __proto__: null})`.
Expected parse rejection; previously accepted. An eval probe independently proves
the wrong-phase consequence: preceding `globalThis.marker=1` executes instead of
being prevented by the early error. [red.log](red.log) records **eight failed /
eleven passed** before the source edit.

The parser tracks one boolean while parsing each actual object expression and
rejects the second setter at its key position ([repair.patch](repair.patch)).
Separate existing pattern parsers retain repeated property names. No extra AST
walk, new abstraction, host authority, budget or timeout adjustment is introduced.

Exact focused commands:

```sh
npx vitest run packages/safe-js/src/parse/duplicate-prototype-setters.test.ts
npx vitest run packages/safe-js/src/parse/duplicate-prototype-setters.test.ts packages/safe-js/src/parse/parser.test.ts packages/safe-js/src/parse/literal-member-assignment-targets.test.ts packages/safe-js/test/conformance/prototype-setter-function-name.test.ts
npx eslint packages/safe-js/src/parse/parser.ts packages/safe-js/src/parse/duplicate-prototype-setters.test.ts
npx eslint packages/safe-js/src/parse/duplicate-prototype-setters.test.ts
npm run build:workspaces -- --workspace=@poe-code/safe-js
npx tsx scripts/screenshot.ts node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/proto-duplicate/smoke.ajs
```

The initial implementation mistakenly called a diagnostic factory with the wrong
signature ([green.log](green.log)); this failed and was corrected to the parser's
existing positioned-error convention. The next check exposed seven test failures
because the test expected lint diagnostics rather than its documented thrown parse
error ([focused.log](focused.log)); the assertion now requires that error. Neither
failed attempt is a pass or an exclusion.

Final checks: **150 passed / zero failed or skipped**, four files, exit 0
([final-focused-json.log](final-focused-json.log)). Source-level strict/sloppy and
module rejection, escaped keys, uncalled functions, nested objects, computed keys,
accessors, methods, shorthand, binding/assignment patterns, ordinary/async arrow
parameters and loop targets are covered. JSON duplicate keys remain ordinary own
data properties. Direct/indirect eval and dynamic Function source reject before
side effects, through three pending checkpoint/replay cycles and completed replay.
Host constructor-chain controls retain absent process/require authority.

Maintained build and both lint commands exit 0; eight built-import checks pass.
Built CLI and SDK reject the same source at line 1, column 27. [CLI screenshot](cli.png)
was visually inspected; caret points at the second key. This fixture has no trailing
newline and does not close the separately recorded trailing-newline caret issue.

[Literal upstream command](command.json), [complete report](upstream.jsonl):
**nine files / eighteen variants / eighteen passed / zero failed, unsupported,
metadata or execution errors**, exit 0. Includes both original duplicate-setter
failures, the two now-repaired name-inference failures and all adjacent prototype
controls. Original fixture bytes, strict/sloppy modes and the clean Test262 pin
`419d3e0a2273ba01a3bfcbec423f2801425b8e93` are preserved. Source fingerprint
`d3cd7eed6b01f8f7a385f54f1f147465a1e44ec196b46fd719a181fcbbe2e4d6`.
The fresh parser change justifies rerunning these interacting prototype controls.

Review: no proxy-only functions, unsafe host access or snapshot-format changes.
The boolean is per literal; decoded property keys determine equality. Parser
failure still unwinds existing compilation ownership and uses existing public
diagnostic conversion. Cancellation and runtime budgets are not modified.
Unrelated local and staged changes are retained ([preservation.json](preservation.json)).

Remaining acceptance blockers: **179 prior primary nonpasses** before edition/
extension disposition, **126 prior secondary resource nonpasses**, focused-owner
reconciliation, full runtime/artifact qualification and the prior caret finding.
Those residual counts are historical, not a newly executed whole-selection result.
No full suite was repeated or falsely adopted from another revision. Local commit,
remote-main delivery and publication are separate; no push was requested or
performed and no remote delivery/release receipt exists for these two repairs.
