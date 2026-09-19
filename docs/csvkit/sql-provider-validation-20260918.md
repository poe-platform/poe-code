# SQL provider implementation validation

The existing fourteen executable names and safe-bash registration are retained.
Both SQL commands now use the exported shared SQLAlchemy-style URL parser and
descriptor-driven driver resolution. The exported declarative provider factory
requires explicit endpoint authorization, credentials and reviewed option
mappings. Default plugins acquire no network/ambient credential authority.
The contract and remaining qualification differences are in
docs/specs/csvkit-database-providers.md.

Reference acquisition installed the hash-locked
requirements-cpython-3.14.2.txt closure into an isolated out environment. The
CPython executable hash, 3.14.2 runtime and all nineteen runtime distribution
versions were checked against the unchanged reference-profile.json. Captures
used C locale, UTC, UTF-8, 80x24 and non-TTY pipes. csvkit's source archive remains
SHA-256 147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b;
uv enforced the source artifact hashes. Python remains reference-only.

New reduced observations include SQLAlchemy URL fields and exact missing-driver
and invalid-URL diagnostics in sql-url-reference.json; Python container/key and
ValueError behavior in sql-container-options-reference.json; and 72 actual
engine/execution-option CLI syntax observations in
sql-syntax-options-reference.json. csvsql's unsupported --execution-option
parser rejection is retained separately from sql2csv's supported flag.

Original failing regressions reproduced missing-driver status78 versus native
status1, memory SQLite empty-path refusal, @ username parsing, execution-option
validation before connection acquisition, credential identity mixing, reserved
option target overwrites and absent shared parser work accounting. Another
agent independently reproduced and fixed sql2csv disposing a result/connection
while an admitted row read remained pending: iterator return is requested
immediately, but cleanup waits for both return and read settlement. Falsey
cancellation reasons and late read rejection retain their original identity.

Final affected-scope checks passed:

- Maintained uncached csvkit workspace build closure (office-package and csvkit).
- Full csvkit unit task: 76 files; 4004 tests passed, one skipped and six TODO.
- Maintained csvkit lint, source TypeScript and test TypeScript checks.
- Independent actual Shell/provider stress: 22 tests passed, no skip/TODO.
- CSV/SQL safe-bash family replay: 440 tests passed, one TODO (441 total).
- Maintained safe-bash integration/build/test runner checks, selected build
  closure and source/test/consumer typecheck (26 current consumer groups).
- Root type and workflow lint routes; guarded root ESLint completed with zero
  errors and two warnings across 15962 subjects.

These counts describe tests, including honest capability-refusal assertions;
they are not a csvkit compatibility denominator. Skips/TODOs and unsupported or
unmeasured profiles remain blockers. Native/network service interoperability,
verbose deployment traceback identity, remaining literal/URL profiles and the
common suite differences have not become passes.

An ad hoc screenshot of actual safe-bash SQL diagnostics was generated through
the maintained screenshot renderer and visually inspected. Missing-driver text,
the qualified SyntaxError and SQLite URL forms displayed correctly. It was
temporary evidence rather than a screenshot test or a retained product asset.

The expanded normal root npm test run exited1: its shared phase completed in
1058.89 seconds with eight timeout failures, 133449 passed tests, three skips and
six TODO (133466 total); 2870 files passed, eight failed and two skipped.
It is not a successful repository gate, and subsequent workspace stages were
not executed. Original PPTX, tiny-mcp-client, two DOCX, shift-jisx0213,
core-codec, PDF and iso2022-jis-revision failures remain evidence rather than passes.
Targeted original DOCX/MCP checks (17 tests) and shift-jisx0213 plane10 passed in
isolation. The timed-out PPTX extraction/repacking fixture was reduced to four
original stored parts, retaining its command/schema/manifest/byte assertions;
its nine-test file and maintained lint route pass. That fixture change changes
implicit compression coverage and does not qualify the broad run.
The other four failing scenarios also pass in isolated selection (seven tests,
including adjacent ISO2022 variants; 6342 unselected tests were skipped and are
not passes). The broad scheduling/timeout profile therefore remains unresolved;
isolated successes do not reproduce or repair the full-run failure.

The broad run began before the final work-accounting and pending-read fixes;
the affected current source was rebuilt and rechecked separately. No full frozen
candidate, release or deployed database qualification is claimed. No README,
staging, commit, push or publication action was performed.
