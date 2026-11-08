# B01 focused author regression policy

This August 28 author cohort repairs only independent B01 from the immutable
August 27 independent freeze/evidence/audit commits `cbed682564e1e3b1c2ac8062157ece7b8b997f30`,
`8e62751d4b3b05cb493bed79aa1fd535df251da8`, and
`e41fbc22eb659e565f0a16f908ef8b6dd31c2df0`. The rejected helper is
`373437cf84424939e1792470805cdd9e60bd3898`, blob
`3b7b55abc14718c0e23aa0c352af392b967a4905`, SHA-256
`f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5`.

The required strict-selector precedence is: an actual root caller remains
highest; an authenticated captured execution origin, including a budget or
pipeline control failure, remains the exact captured failure; only an
authenticated invoke cancellation participates in ranked invoke replacement.
An invoke cancellation may still replace a return or a captured invoke failure.

Authentication occurs before precedence. An observed origin must still be the
exact visible helper origin with an `Object.is`-equal captured reason. A report
must still pass the existing private target, origin, and reason checks. Equal,
falsy, or `NaN` values do not create provenance. An unknown escaping rejection
therefore remains unrelated even when equal to a visible control reason.

The eight focused cases cover both authenticated routes and both control roles,
plus root priority, unknown-equal rejection, genuine invoke ranking, and close
stability. They are not a copy, replay, or rescore of the independent 12-case
family. The historical independent 11/12 isolated and 11/12 moved results remain
unchanged. No independent, Runtime, Shell, contract, timeout, native, or Stage 2
cohort is executed or claimed here.

Fixture version 2 removes one pre-freeze v0 assertion that incorrectly expected a
control cancellation to replace a successful return after close. B01 concerns an
authenticated captured control failure; control origins do not replace returns.
The correction also makes origin-mismatch diagnostics concise without weakening
identity checks. `PREFREEZE-ATTEMPT-v0.md` retains the attempt and exact result.
