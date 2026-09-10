# Regex literals inside template substitutions

## Validated failure

During the frozen full package run, an ad hoc Test262 selection executed the
19 `argument-string*` fixtures under `Temporal/PlainTime/from` from revision
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Tests used their declared upstream
helpers, YAML metadata, and both normal and strict script modes. Twenty of 38
runs passed; eighteen stopped with `Unterminated template literal` (fcc147).
Those eighteen are nine fixtures failing to parse temporalHelpers.js, not
eighteen proven Temporal semantic bugs. The shared helper contains a regex
literal with a quote inside a template substitution.

Minimal built-guest reproductions (b67a2e), all valid native JavaScript:

```js
return `${/'/.test("'")}`; // native "true", guest parse error
return `${/"/.test('"')}`; // native "true", guest parse error
return `${/}/.test("}")}`; // native "true", guest incorrect string
return `${/{/.test("{")}`; // native "true", guest parse error
return `${/`/.test("x")}`; // native "false", guest parse error
return `${6 / 2}`;         // both "3": preserve division handling
```

## Cause and next implementation

The tokenizer's readTemplate/skipTemplateExpression already tracks lexical
context and consumes regex literals, including their delimiter-like contents.
The parser then independently scans token.value in findTemplateExpressionEnd,
which skips strings, templates and comments but not regex literals. It mistakes
regex contents for interpolation structure. Adding an unconditional slash skip
would instead break division, comments and lexical-goal distinctions.

Preserve the expression boundaries discovered by the tokenizer and consume
those boundaries when creating TemplateLiteral nodes. Remove the redundant
parser scanner where it becomes unused. Keep nested/tagged templates, raw and
cooked strings, spans, lexical contexts, regex compile budgets, and division
semantics unchanged. Add failing parser/runtime tests first, including braces,
quotes, backticks, character classes, escaped slash, comments, nested templates,
and division controls. Then rerun the unmodified upstream selection to expose
any actual Temporal failures previously hidden by helper parsing.

Source changes must wait until full package session 54411 terminates. Its
fingerprint is still frozen; this diagnosis used read-only source inspection
and built-runtime probes. No production fix, passing full gate, push, or
release is claimed here.

## Implementation and regression evidence

After session 54411 terminated, added 13 native-oracle regression cases. The
unchanged implementation failed 11 and passed two division/comment controls
(791f00). Failures included silent corruption of output and tagged-template
quasis, not just parse rejection.

The tokenizer now records substitution offsets relative to each template token.
The parser consumes these offsets directly; its redundant template-expression
scanner and associated string/comment scanners were removed. Nested templates
are independently tokenized when their embedded expressions are parsed.

The 13 regressions and 25 tokenizer tests passed (a4eb5e). The broader parser,
runtime template, generator/snapshot template, and regex compile-policy selection
passed 1,616 tests with one skipped across 67 files (829e7c). Focused lint
passed (09e035). The maintained workspace build passed all 23 build tasks and
five fresh ESM import checks (a680d2).

Built CLI validation passed; the inspected screenshot is
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-template.ajs.png`.
It shows correct quote/brace regex results, nested output, division and tagged
quasis/values. The unmodified upstream PlainTime selection completed successfully
(efadaa): all 19 fixtures passed in both normal and strict script modes, 38/38
runs with no failures at the pinned revision above. The 18 prior helper-parse
failures are resolved. This qualifies this selection and the local parser fix,
not the entire Test262 corpus, a full-package pass or a delivered release.
