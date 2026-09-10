# Dynamic import attribute reflection

## Validated defect

At ff90931d4, dynamic import enumerates attributes through a data-only helper.
A native Node probe logs `keys`, `desc:type`, `get:type` for a Proxy attributes
object while public SafeJS execution logs nothing (7c9de1). This happens before
the host's import-support decision, so rejecting nonempty attributes is not a
reason to skip the observable reflection.

The [EvaluateImportCall algorithm](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-evaluateimportcall)
uses EnumerableOwnProperties before validating values and supported keys.
That requires string-key filtering, live descriptor checks, ordered getters,
and promise rejection for abrupt reflection operations.

Eight main-worktree regressions fail before the repair (12d068): Proxy ownKeys,
descriptor and get effects; empty/hidden/symbol-only attributes; an earlier
getter making a later property enumerable; and asynchronous rejection preserving
the thrown marker for each reflection trap.

## Repair

Export and reuse the existing `getOwnEnumerableProperties` implementation used
by Object reflection. Dynamic import collects its values, retains them through
validation, then performs the unchanged string-value and supported-attribute
checks. It does not add host module types, filesystem imports, or network access.
All attribute getters still run before string-value validation.

Verification command 78998 passed 1,285 tests with 33 skips across 26 module,
dynamic-import parser, lint and snapshot files (c0b087), and package TypeScript
passed (cf8ffe). ESLint identified a now-unused import from the replaced path;
it was removed and the final scoped lint check passed (f3dca6). README is updated. No visual CLI impact
requires screenshots. No push or release during the release hold.
