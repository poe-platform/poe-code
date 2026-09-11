# Remaining for-in parser gaps

## Integration gate held stable

The full maintained SafeJS package test is running against runtime 3cd9fad79:

`npm test --workspace=@poe-code/safe-js -- --reporter=json --outputFile=/tmp/safejs-post-loop-header-integration-results.json`

The live execution session is 93978. All 100 filesystem type contracts passed
before the unit task started (32bf27). A subsequent poll still reports the same
session running (9d5078). No completion or new full-suite pass count is claimed.
Runtime and test files have not changed during this audit; new findings below
are read-only probes. Do not restart the gate merely because JSON mode is quiet.

## Previously excluded top-level fixtures

At Test262 revision `72faf8ec1445c55149615e8b35187830783aba1a`, qualify the nine
previously excluded noStrict files in `test/language/statements/for-in` through
native and guest Function constructors. Native controls use isolated VM contexts;
runtime assertions and includes remain unchanged inside the function body.

Results (20a165):

- Three runtime passes: head-var-bound-names-let.js,
  identifier-let-allowed-as-lefthandside-expression-not-strict.js,
  scope-head-var-none.js.
- Three expected SyntaxError rejections: head-const-bound-names-let.js,
  head-let-bound-names-let.js, let-array-with-newline.js.
- Three guest parser failures after native success: head-lhs-let.js,
  let-block-with-newline.js, let-identifier-with-newline.js.

## Independent reproductions

Read-only comparisons confirmed these native-valid sources fail guest Function
compilation (e58f5b):

```js
for ([][0] in {a:1}) {}
var x; for ([x][0] in {a:1}) {}
for ({a:1}.x in {a:1}) {}
for ([][0] of [1]) {}
```

The parenthesized control `for (([])[0] in {a:1}) {}` passes. This is not limited
to sloppy `let`: parseAssignmentTarget immediately parses leading arrays/objects
as assignment patterns and does not recognize a literal's following member access.
The same parser is used for nested assignment-pattern targets, which also need
coverage when repairing this path. Preserve valid destructuring and early errors.

The separate newline cases fail after native success:

```js
for (var x in null) let
{}

for (var x in null) let
x = 1;
```

In a non-strict statement-only body, `let` can be an IdentifierReference and ASI
ends that expression before the following block or assignment. The parser instead
tries a lexical declaration, producing a missing initializer or redeclaration
error. Statement-list contexts still allow lexical declarations across newlines;
the repair must respect that grammar distinction and keep `let [` restricted.

## Destructuring subdirectory

The dstr subdirectory contains 33 files. Strict qualification rejects 32
parse-negative fixtures with no unexpected accepts (ffed95). Its one noStrict
fixture, obj-id-identifier-yield-expr.js, also produces SyntaxError in native and
guest Function compilation (283aa6). No runtime fixtures occur in this selection.

Combining these supplements with the previous probe accounts for all 119 files:
54 runtime passes, 62 expected parse rejections, three confirmed parser failures.
Modes use the stated strict Script or non-strict Function harness; this is not an
official Test262 runner or complete JavaScript-conformance result. Earlier strict
parse rejection results do not establish exact guest error branding.

## Next actions

Fix literal-member assignment targets and sloppy statement-body ASI separately,
with independent failing regressions before code changes. Keep main runtime
sources stable until the existing integration gate is terminal, or develop in an
isolated copy. Preserve other staged/uncommitted files. Release hold remains active;
no push, publication or issue closure follows from these findings.
