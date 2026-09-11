# Repair the September 8 SafeJS release build

The normal build on upstream `04b1bbd25` fails with five TS2304 diagnostics at
`interpreter.ts:4214`: primitive deletion boxing was inserted into the unrelated
optional-call branch, where `target` does not exist. The preceding delete-value
change was also inserted into the nullish-member branch instead of the
non-member-operand branch.

Reproduction on the current code: the existing primitive/value deletion suites
have 12 failures and 16 passes. Two additional native-oracle regressions prove
nullish member bases are evaluated twice, including optional chaining.

Move each implementation into its intended branch, preserving primitive
deletion and value-expression evaluation rather than reverting either feature.
Keep member deletion from reading getters and preserve nullish errors, optional
short-circuiting, and abrupt completions. Validate the focused deletion suite,
the maintained SafeJS build closure and package tests before delivering this
repair independently of pending SafeBash portability changes.

While local validation was running, upstream commit `c7429ccc2` independently
delivered the same repair. Preserve that implementation instead of pushing a
duplicate; retain the two additional single-evaluation regressions here. The
following upstream commit `555671f64` includes the repair. Its normal GitHub build
passed, and scoped release run `34260928976` successfully published SafeFS,
SafeJS, and Safe Bash `0.1.487` on September 8, 2026. Root release run
`34260929340` is still validating; a scoped publication is not a completed root
release.

Local evidence before rebasing onto the upstream implementation: 110 focused
deletion/import tests passed; the maintained SafeJS dependency build closure and
four postbuild import checks passed; repository ESLint, type lint, and workflow
lint passed. Full package tests finished with 21,522 passes, four failures, and
37 skipped cases: three native-constructor expectations and German narrow
microsecond spacing. Revalidate the retained regressions after rebasing; do not
claim this local implementation was pushed or the full package suite passed.
