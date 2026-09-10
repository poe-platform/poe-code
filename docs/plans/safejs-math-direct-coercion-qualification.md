# Direct Math coercion: contract qualification

## Evidence at 246946605

Read-only probe 91d022 covers 35 numeric Math intrinsics with guest `valueOf`
closures. With no call context, none invoke the closure: most return NaN,
while integer-conversion methods return other numeric values. Supplying an
empty execution context makes all 35 match native numeric results and expected
conversion traces. The ordinary guest path already has conversion coverage in
`math-coercion.test.ts`. This does not establish an ordinary guest-language bug.

`createMathGlobals` is an internal factory, not an export of core.ts/index.ts.
Do not describe this probe as a public SDK conformance failure without testing
an actual supported entry point.

## Isolated candidate, not integrated

An isolated copy at `/tmp/safejs-math-direct.5SIhoe` contains a candidate that
always uses `sandboxNumber` instead of host unary-plus in context-free calls.
Main runtime and tests stayed unchanged while the integration gate ran.

The new direct-call file has 113 cases. Against the unchanged copied source,
111 fail and two pass (eb6e0a). It checks three conversion hooks for each of
35 methods, abrupt completion, BigInt/Symbol rejection, primitive synchrony and
ignored arguments. An initial setup attempt ran no tests because the temporary
root lacked tsconfig.json; that was corrected before this baseline.

After the candidate change, the complete eight-file Math selection reports
526 passes, seven failures, two skips and two unhandled rejections (cf9d03).
Failures are in existing f16round tests, which require synchronous direct
coercion of native arrays/objects and native conversion functions. The new
candidate instead returns asynchronous guest conversion, and does not invoke
native functions as guest closures. Both candidate files pass scoped ESLint
(ada105), but that does not qualify the behavior change.

Do not transfer this candidate or rewrite those existing expectations merely
to get green tests. Native host-object convenience calls and guest-value calls
need an explicit, coherent contract before sharing this path. Runtime source
inspection alone does not justify removing established direct-call behavior.
The tests with unrelated user edits remain untouched.

This is retained evidence of an internal contract inconsistency, not a shipped
repair. The general JavaScript-completeness goal remains open; release hold
remains active. No visual change or screenshot validation is involved.
