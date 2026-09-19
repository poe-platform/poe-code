# csvstat validation

The literal implementation and applicability contract are in
[csvstat specification](../specs/csvstat.md). Procedures are in
[implementation QA](../plans/csvstat-qa.md) and
[independent stress QA](../plans/csvstat-stress-qa.md).

## Reference qualification

Released source archive SHA-256:
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Downloaded archive hash was verified before extracting the utility. csvstat.py
hash: `049d7423f21e8b1097418d4855111e8d99871c7d387a2129c99ae79c95e1ccc5`.
CPython 3.14.2 binary hash matches the frozen original profile:
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`.
The existing pinned CPython dependency lock was replayed without changing it;
its SHA-256 is
`7ecb88fddc47bb86867cf738670b24ed88f11f671feef127246b0d422a71d7a8`.
Agate 1.14.2, Babel 2.18.0 and SQLAlchemy 2.0.54 match that profile. Drivers and
unsupported service observations remain those recorded in reference-profile.json;
this command does not exercise a database or network driver.

`csvstat-reference.json` retains 241 original exact stdout/stderr/status cases
under the frozen C/UTC, UTF-8, 80x24 environment, with its utility/lock hashes.
Its formatter table records the original locale.format_string return values
before csvstat's trimming. The acquisition wrapper only observes that formatter
and filters its separate instrumentation records from captured stderr; product
stdout, diagnostics and statuses are otherwise retained. Canonical tests replay
these observations with injected formatters and in-memory streams. No Python,
native programs, files, network or database services run inside the new tests.

## TDD and fixes

The first original scalar mean regression failed with status78 and the old
Agate-metrics blocker before implementation. All thirteen OPERATIONS entries are
covered for Boolean, Number, Text, Date, DateTime and TimeDelta by the first
six-column differential matrix. Subsequent cases cover null/empty/singleton
inputs, Decimal precision/rounding/nonfinite/signed-zero data, temporal arithmetic,
frequency counts/ties, scalar labels, column selection, formatting and serializers.
JSON cases include negative, zero and twelve-space indentation.

The initial implemented corpus passed 169/172 differentials. Three failures
exposed stripping a rounded Decimal square root's significant trailing zero;
the fix trims only mathematically exact roots, preserving precision-28 results.
All 241 expanded native cases now pass, including close precision-28 values,
large whole parts, NaNs, temporal offset equality and microsecond means.

A different agent initially reproduced seven metric blockers in twelve stress
cases, then independently found naive/aware DateTime frequency merging with two
exact failing registered-engine tests (21/23 passed). Root fixed the key to
preserve awareness while equal aware instants still share a bucket. Further
original failing coverage showed that a host formatter Error with the same
message as an internal calculation error could be swallowed; typed internal
calculation errors now preserve host error identity. No unrelated source fixes
or Git actions were included.

## Maintained checks

- `npm run test --workspace=@poe-code/csvkit`: 47 files, 2,587 passes, one skip
  and six TODOs. The seven unavailable cases remain blockers, never passes.
- `npm run lint --workspace=@poe-code/csvkit`: ESLint plus source and test
  TypeScript checks pass.
- `npm run build:workspaces -- --workspace=@poe-code/csvkit`: maintained
  uncached two-build dependency closure passes after the final code change.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: maintained
  uncached ten-build dependency closure, safe-bash build checks and postbuild pass.
- Actual registered-engine focused Node/tsx tests: 28 independent csvstat stress
  tests pass without skips/TODOs; the existing eight csvkit integration tests pass.
  Coverage includes exact VFS pipeline/redirection effects and unchanged input
  bytes, raw count precedence, reusable buffers, cancellation, backpressure,
  idempotent cleanup, formatter failure identity and explicit Decimal budgets.
- Maintained discovery tests: all 109 pass. The new stress test is registered
  by literal path without changing any historical seals or existing assertions.
- Focused integration ESLint passes. `npm run typecheck
  --workspace=@poe-platform/safe-bash` passes source/tests and all 26 maintained
  public-consumer groups, with the negative fixtures rejected as declared.
- The repository screenshot utility captured actual built safe-bash detailed
  output for selected Number/Text columns. The image was viewed: labels,
  continuation alignment, null annotation, character count and total rows are
  correct. The renderer's font lacks the emoji glyph; exact Unicode output bytes
  are separately verified by native differential and registered-engine tests.

Only domain command logic and the literal discovery assertion change existing
product/integration files. The already-registered command family and public
exports are reused, so no root export or default inventory changes are needed.
The original fourteen names remain intact. No new runtime dependencies exist.
After recording results, this task's temporary capture environment, tools and
screenshot in out/csvstat-reference are removed; retained reference fixtures and
specifications remain in docs.

## Explicit limits

This is measured csvstat coverage, not full csvkit-suite or all-input compatibility.
Shared numeric input quoting modes2/4/5 remain unqualified and return explicit
status78. Existing codec, inference locale/temporal directive, warning deployment
identity and verbose Python traceback gaps remain explicit blockers. Only the
frozen process-C formatter observations are qualified here; other locale profiles
and percent formats require independently qualified host formatter bindings.
No native service, interactive/TTY or full arbitrary locale coverage is credited.
The pre-existing broader command-suite blockers remain documented separately.

No README content, staging, commits, pushes or publication were performed.

## Additional user edge review

The subsequent independent user review runs the 241 frozen observations through
the actual registered Shell, adds twelve freshly measured argument cases and
two VFS/pipeline checks. All 255 pass. Together with the existing stress and
integration files, the focused registered-engine rerun passes 291 tests without
skips/TODOs. Procedures are in docs/plans/csvstat-user-stress-qa.md.

A freshly requalified C/UTC CPython 3.14.2 sweep compares twenty numeric, Unicode
and temporal JSON cases. Original Python, utility and lock hashes match those
above; the nineteen dependencies were installed with required artifact hashes.
The sweep validated a maxprecision defect: finite values overflowing float were
included, although Agate's math.isinf check excludes them. Native scalar results
for 1e10000/2e10000, +/-1e309 and 1e309/0.125 are respectively 0, 0 and 3. The
new regression first failed with -9973 for the first input; the source fix mirrors
the float finiteness check before Decimal normalization. Nineteen sweep cases
now match exactly and are canonical in-memory differentials. The remaining
1e-10000/2e-10000 full report hits the shared arithmetic exponent budget (status78
rather than native status0); both results remain in csvstat-user-reference.json
as an explicit blocker, outside the passing cases.

The maintained domain test rerun passes 2,607 tests across 47 files. The existing
one skip and six TODOs remain unqualified. Domain ESLint/source/test typing pass,
and the maintained safe-bash ten-build dependency closure/postbuild pass. The
built detailed report was captured with the repository screenshot utility and
visually inspected: labels, null annotation, continuations and row count are
correct. New literal test discovery is registered without modifying seals.
See docs/plans/csvstat-user-edge-qa.md for procedures and red evidence.

Final discovery rerun passes all 109 cases, focused integration ESLint passes,
and safe-bash typecheck passes source/tests and all 26 public-consumer groups
with declared negative fixtures rejected. No runtime/service parity is inferred
from typing. This review's out/csvstat-user-reference environment, captures and
screenshot are removed after recording results; staging and Git history remain
unchanged.
