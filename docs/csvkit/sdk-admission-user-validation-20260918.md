# SDK admission and independent Shell user review

The original regression placed an invalid columns array after matchfile in a
csvgrep SDK request. The engine rejected the setting but opened the match file
first: the failing assertion observed one open rather than zero. SDK run now
validates and owns all supplied settings before acquiring a match-file handle.
It captures setting entries once, preserving single getter evaluation, and
explicit null matchfile retains pattern mode without requiring an opener.
Original executable argv parsing retains its eager FileType behavior.

The new getter regression initially failed against the intermediate two-pass
implementation (two reads rather than one). Capturing the entries once fixed
that regression. Exact valid output, empty malformed-request stdout/stderr,
zero resource acquisitions and zero registered cleanups are asserted.

Independent review extended the already registered
packages/safe-bash/tests/commands/csvkit-input-lifecycle-user-review.test.ts:
synchronous/asynchronous named read failure combined with failing return keeps
the primary PermissionError, invokes return exactly once through disposal, and
does not consume borrowed stdin. Synchronous iterator acquisition ENOTDIR also
retains the original path diagnostic. These cases passed without a product fix.

Verification on the live working tree:

- Maintained csvkit workspace unit route: 89 files, 4,200 passed; one skip and
  five TODOs excluded. Counts include refusal/resource assertions, not only
  native compatibility cases.
- Maintained csvkit lint: ESLint and product/test TypeScript checks passed.
- Selected uncached csvkit build closure: four declared workspace builds passed.
- Three selected Shell lifecycle/ownership/binding files: 23 passed without
  skips or TODOs. Final rebuilt lifecycle file: six passed.
- Maintained safe-bash typecheck: source/tests and all 26 current consumer
  groups passed, including expected negative-consumer rejection. This is
  declaration qualification, not runtime acceptance.
- Guarded repository ESLint: completed with exit 0, all 16,007 configured
  subjects linted, zero errors and two unrelated docx-test warnings. All 18,067
  input opens closed; no guard gaps were reported. The large metadata receipt
  was truncated in tool presentation; its completion summary was visible.

The QA procedure is docs/plans/csvkit-sdk-admission-user-qa.md. This focused
review does not cover every edge case or establish full csvkit 2.2.0 parity.
Existing unqualified regex, compression, numerical and service/profile paths
remain blockers. No README, staging, commit, push or publication action occurred.
