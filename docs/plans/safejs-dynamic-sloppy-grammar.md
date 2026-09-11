# Non-strict dynamic function gaps

Current-source differential checks against an isolated native Node VM establish
four gaps. The regression file is
`packages/safe-js/src/interp/globals/dynamic-sloppy-grammar.test.ts`.

| Function body | Native | Current SafeJS |
| --- | --- | --- |
| `with({x:7}){return x}` | `7` | SyntaxError |
| `return 077` | `63` | SyntaxError |
| `return '\141'` | `"a"` | SyntaxError |
| `if(true){function f(){return 7}}return typeof f` | `"function"` | `"undefined"` |

The focused run reports four failures and four passing strict-mode controls.
These are validated limitations, not delivered fixes. The tokenizer currently
rejects legacy literals before the dynamic parser can apply its non-strict
context. A fix must preserve strict nested functions, class bodies, directives
and templates; globally relaxing token validation would be incorrect.

Implement each semantic improvement separately with native comparisons,
resource checks and snapshot replay where state is involved. Block-function
hoisting needs lexical-conflict and conditional-execution coverage; `with`
needs object environment lookup, receiver and Symbol.unscopables handling.

## Block-function regression expansion

`dynamic-block-functions.test.ts` compares 13 complete function bodies against
a native VM. Six fail and seven controls pass. Failures cover execution of a
block declaration, initial hoisting, replacement of a var binding, successive
blocks, per-iteration closures and independence of later block-binding writes.
Controls preserve absent conditional execution, lexical-name conflicts and
strict/async/generator declaration behavior. Do not implement unconditional
function-scope copying: the declaration must execute, and lexical conflicts
must suppress the legacy outer binding.

The local implementation collects eligible declarations without descending
into nested functions, creates their outer var bindings on invocation, then
copies the block binding when the declaration executes. Initial 13 cases pass;
expanded block and existing constructor suites pass 86 tests. A native catch
comparison required distinguishing simple catch parameters from destructuring.
One proposed switch control was itself invalid native syntax and was replaced
with a valid outer-lexical-binding control, not counted as a runtime defect.

Still validate initial arguments with default parameters, resource accounting,
recursive calls and snapshot replay before delivering this runtime change.
The [Annex B function-instantiation rules](https://tc39.es/ecma262/2024/multipage/additional-ecmascript-features-for-web-browsers.html#sec-web-compat-functiondeclarationinstantiation)
require both eligibility checking and an execution-time binding update.

The default-parameter arguments control reproduced premature shadowing by a
new var cell; skipping creation of the special arguments binding fixes it.
All 23 focused cases then pass. Expanded recursion, snapshot and existing
retained-root/compile/data-budget coverage passes 62 tests across five files.
Snapshots cover returned closures, declarations before and after await, and
generator/async-generator continuation. Lint flagged a this-alias in scope
traversal; traversal now follows the existing recursive parent-scope pattern.
Recheck after that edit and verify direct captured-data accounting as well.
Do not substitute merely accepting the syntax for implementing its semantics.

Direct if-clause functions were accepted but lacked Annex B synthetic blocks.
Native comparisons reproduced rejection of a valid outer-let shadowing case and
acceptance of an invalid strict unbraced function. The parser now creates a
synthetic block for non-strict ordinary function clauses, using a parser scope
while reading the declaration, and rejects strict/async/generator forms.
An initial 1,144-pass parser/runtime run still failed outer-let shadowing because
the synthetic AST alone did not establish a parser scope; that is now corrected.
Six block-function snapshot controls pass, including an unbraced if declaration.
These edits postdate the isolated candidate unit run and are not in it yet.
https://tc39.es/ecma262/2026/multipage/additional-ecmascript-features-for-web-browsers.html#sec-functiondeclarations-in-ifstatement-statement-clauses
