# csvstat final metrics validation

The documented nonzero Decimal square/variance discrepancy is fixed. Before the
change, four of the five original symmetric-pair variance regressions failed
exactly; two new square tests failed because the required operation was absent.
No original reference observations were rewritten.

CPython 3.14.2 `Modules/_decimal/libmpdec/mpdecimal.c`, SHA-256
`4f89b8095e408a18deff79cfb605299e615bae747898eb105d8936064f7fb626`,
defines integer power's working precision as context precision plus exponent
digits plus exponent scale plus two. Squaring therefore rounds half-even at
precision 31, then finalizes at precision 28. Implementing that sequence fixes
all five original squares and all five original symmetric-pair variances exactly.
Finite zero squares keep exponent zero; signed infinities square to positive
infinity; quiet NaN payloads/signs and signaling traps are preserved.

The implementation stays in the TypeScript domain workspace and is consumed by
the existing csvstat engine. No subprocess, capability acquisition, registration,
argv, stream or cleanup behavior was added. Decimal multiplication retains its
existing precision-28 behavior. The independent agent's measured 5,009-input
square qualification and 96 original command observations are recorded in
`csvstat-final-edge-validation.md`; its 21 extreme-exponent blockers remain
separate from passing observations.

Current uncached checks:

- Domain `npm test --workspace=@poe-code/csvkit -- --maxWorkers=1`:
  2,627 passed in 48 files; one existing skip and six existing TODOs remain
  unqualified. No timeout or test expectation was weakened.
- Domain `npm run lint --workspace=@poe-code/csvkit`: source lint and source/test
  TypeScript checks passed.
- Selected maintained domain and safe-bash build closures passed, including
  safe-bash's native postbuild script.
- Focused registered-shell csvstat stress, user-edge, metrics-review, final-edge
  and csvkit integration tests: 650 passed, zero failed/skipped/TODOs.
- Maintained integration discovery tests: 109 passed; the new stress file is
  registered by exact literal path.
- Focused ESLint for the new stress file and changed integration-discovery
  assertion passed.
- Maintained safe-bash typecheck passed source/tests, historical compile-only
  models, four source consumer groups and all 26 current public-consumer groups;
  all three declared negative fixtures were rejected as expected. This is type
  validation, not runtime or real-service acceptance.
- Repository screenshot utility captured the built registered Number report;
  the image was inspected for aligned labels, StDev, frequency continuations,
  null annotation and row count. All rendered correctly.

These focused checks do not certify complete csvkit compatibility. Existing
extreme Decimal exponent admission, locale host qualification and unsupported
filesystem/network/database/interactive cases remain explicit limits in the
suite specifications. No README content, staging, commit, push or publication
was changed. Task-owned temporary captures are purged after verification.
