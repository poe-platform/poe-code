# Current csvkit user edge review

This review measures the preserved dirty working tree on September 19, 2026.
No commits, pushes, releases or README changes are authorized or performed.
The procedure is [the current user edge QA](../plans/csvkit-current-user-edge-qa.md).

## Fresh reader differential

The isolated stdlib reference executable is CPython 3.14.2, SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`.
Its bounded regular-file identity was checked before native execution. This
reauthenticates the reader interpreter, not the full frozen csvkit installation.
The probe uses `-I -B`, C locale, UTC, UTF-8, pipe input/output, and no imported
csvkit or optional dependency. Product code does not launch the reference.

Enumerate the empty string, then lengths one through five, breadth first, with
alphabet order `a`, comma, double quote, backslash, LF, CR. Each next layer
iterates the preceding prefixes before alphabet characters. All 9,331 inputs
are passed to `csv.reader(io.StringIO(text, newline=None), escapechar='\\')`.
Preserve each row's cells and `reader.line_num` as `{cells,line}`. The compact
UTF-8 JavaScript JSON array of inputs hashes to
`ec9e3ebb8f308422ac2e7caf8dd825e0a49d7fc0ccd0333ec002979948a940be`.
The compact JSON array of native record arrays hashes to
`efdeb5f0f00c95f7f699a92167988280e90105457b280203343236b413bfec9e`.

Both compiled public JavaScript readers match the native records exactly.
The streaming probe supplies universally normalized physical lines, including
their newline terminators, without an invented final empty iterator item.
The new canonical regression reproduces both complete record digests and checks
direct/streamed records for each input, entirely in memory. It invokes no native
program and creates no files. Its bounded corpus establishes no numeric quoting,
sniffing, encoding, arbitrary-length or optional-profile parity.

| Fresh differential denominator | Implemented and matched | Failed | Unmeasured | Capability divergent |
| --- | ---: | ---: | ---: | ---: |
| Direct reader inputs | 9,331 | 0 | 0 | 0 |
| Physical-line reader inputs | 9,331 | 0 | 0 | 0 |

## Independent registered-command review

A different agent authored six new actual safe-bash cases. Synchronous and
asynchronous failed input-open acquisition produce the exact PermissionError
once and never acquire content/stdin. An explicit input-open capability takes
precedence over VFS content operations. Absent SQLite injection returns the
honest status-78 refusal without consuming supplied query stdin. Synchronous
and asynchronous failed driver acquisition are not retried at disposal; subsequent
version execution succeeds. The six cases and adjacent snapshot/input/probe/SQL/
final-user lifecycle suites pass 34/34. These are lifecycle/capability tests,
not 34 newly qualified native compatibility cases. No binding defect was found.

The integration owner added the new file's literal discovery assertion without
changing unrelated inventory assertions or staging. Discovery passes 109/109;
the maintained safe-bash runner passes 536/536.

## Inventory and SDK audit

The compiled public domain descriptors and safe-bash definitions match the
independently expected fourteen original executable names. Every compiled action
matches the frozen register's declaration exactly: 415 expanded actions including
each command's help/version. These name/action inventories have zero unknown
omissions. Inventory matching is separate from operational implementation status.

Compiled declaration AST checks match all 387 operational action instances to
their command-specific SDK settings, with no missing/extra destinations. The
28 help/version action instances remain available through SDK execute(argv).
Actual public Shell help/version output is compared independently against the
frozen native observations, including stdout/stderr/status, for all fourteen names.

The source-flow AST audit separates **23 common and 135 local** `add_argument`
calls from one `sql2csv.set_defaults` call at source line 42. Together these are
the 159 entries in the broader parser-declaration inventory. Argparse's implicit
help is additional to the source-call census. Per-file local argument
counts are csvclean 10, csvcut 4, csvformat 9, csvgrep 7, csvjoin 7, csvjson 11,
csvlook 7, csvpy 5, csvsort 6, csvsql 22, csvstack 4, csvstat 24, in2csv 12,
sql2csv 7. Positional operands are included. Initial counting incorrectly treated
the defaults override as an argument, yielding 136; AST method classification
resolves that error without discarding any source feature. Runtime collection/
branch attribution is not inferred from call counts.
All 159 source-flow declaration path/line identities occur in the feature register;
the distinct sql2csv defaults override also matches its compiled descriptor.

All eight declared input formats remain present: CSV, DBF, fixed, GeoJSON, JSON,
NDJSON, XLS and XLSX. csvstat retains names, type, nulls, non-nulls, unique, min,
max, sum, mean, median, stdev, len, max-precision, freq and count, with freq-count
and formatting controls. Existing canonical format/statistical tests are included
in the fresh domain run; this inventory alone qualifies no complete feature.

The coverage ledger remains honest: zero attributed qualified passes; all 415
option actions, 323 branches and 159 parser declarations are unresolved, with
14,817 upstream test declarations and 52 static assignments retained. There is
no current exhaustive failed/capability-divergent total for that ledger: those
statuses remain unmeasured until authenticated case attribution is supplied.
Do not substitute this review's reader or unit totals for those denominators.

Source-shipped SQLAlchemy dialects remain mssql, mysql, oracle, postgresql and
sqlite. The eight recorded absent optional modules are zstandard, IPython,
psycopg2, pymysql, MySQLdb, pyodbc, oracledb and dateutil in each frozen profile;
dateutil's historical mention does not create a current source dependency.
Driver/DSN transport descriptors require injected real drivers and independent
service qualification. SQLite's explicitly injected WASM/VFS evidence is separate.
Known bzip2/xz and Agate Table mismatches, unavailable zstd/IPython/TTY/SIGPIPE,
numeric/null quoting-mode refusals and frozen installation manifest drift remain
blockers. Known source quirks retain their source-flow and feature-audit records;
this review does not replace their unresolved case attribution with passes.

## Current checks and visual review

The normal uncached root build passes, including declared workspace closure and
root suffix stages. Final maintained domain tests pass 104 files, 4,426 tests,
with five TODOs excluded. Domain lint/source/test types pass.

Repository lint passes the maintained ESLint, type and workflow routes. Its
guarded ESLint receipt is complete with zero errors, two warnings and no gaps.
Focused changed safe-bash/inventory ESLint and maintained safe-bash source/test/
consumer typechecks pass. Final actual-Shell workflow/lifecycle verification
passes 42 tests with one explicit TODO in 43 tests; the TODO is not a pass.

Actual registered csvlook tables with row/width limits, multiline cells, csvstat
count/mean, version/selector errors, csvclean CSV, missing csvpy guest and missing
SQLite binding were captured through the maintained screenshot tool and opened
with view_image. Columns, truncation and statuses are readable; long native-style
errors stay unstyled. The two absent capabilities visibly return status 78.
The injected C formatter is limited to these small sample numbers and does not
qualify a general locale implementation. No product visual behavior changed.

The separate maintained `npm run screenshot-poe-code -- --output
out/csvkit-current-poe-help.png bash --help` capture was opened and reviewed.
Its root CLI help is readable and exposes no csvkit capability option; CSV
registration is available through the explicitly bound public Shell plugin.
The screenshot route's build preparation briefly removed generated safe-fs
exports during an overlapping public check and seven focused file startups.
Those failed attempts are retained here as setup interference, not passes.
Repeating the public and focused checks after preparation completed passes.

The [machine-readable audit](current-user-edge-audit.json) identifies 228 current
domain/binding source/test files by sorted compact `{path,sha256}` records and
separates scoped counts from unresolved exhaustive attribution. Frozen source
manifest and both original oracle JSON digests reproduce reference-profile.json.
No live complete frozen dependency installation is newly requalified.

Ordinary uncached `npm test` completes with exit 1. The maintained shared Vitest
phase reports 2,908 passed files and two skipped files, 133,895 passed tests,
two skips and five TODOs, total 133,902. These are shared-phase counts, not an
aggregate repository pass. Earlier native workspace tasks and the maintained
safe-bash runner pass within their respective scopes. The safe-bash workspace
admits 1,271 current files and reports **42,554 tests: 41,705 passed, 24 failed,
zero cancelled, 823 skipped and two TODOs**, in 1,043.94 seconds. All 24 failures
are the two archive-authority checks and 22 public-cleanup setup failures below.
The numeric-cell and unavailable shell-descriptor TODOs are not passes.
Subsequent stopped workspace tasks remain unmeasured; the repository gate fails.
Full parity and repository acceptance remain blocked.

Fresh isolated checks already reproduce two acceptance blockers. Read-only
`inspectCommittedCandidate(cwd, 'HEAD', cwd + '/out')` reports `committed build
input differs from reviewed authority: scripts/build.mjs`. Its verifier compares
preserved modified build authority with committed HEAD. The task forbids commits
and reverting others' edits; weakening that comparison is not a valid repair.
The original public-cleanup suite reports 22/22 setup failures in 4.02 seconds,
all caused by `Unadmitted peer public route: @e965/xlsx` in peer.mjs:397. An
ordinary successful public import does not certify this packed/bound consumer.
Supporting this external executable closure requires separate faithful dependency
admission/staging, not deleting a guard or declaring its failures pre-existing
passes. These failures remain unresolved and exclude repository acceptance.

The initial additional defaults probe compared the register's Python repr string
`'{}'` directly with a JavaScript object and failed. Classifying the actual
source AST keywords instead verifies all compiled defaults, including the nine
sql2csv overrides; that probe setup error is not a product failure. No native
output or original failed case was normalized, overwritten or weakened.

Owned temporary probe helpers, logs and three reviewed screenshots were reduced
into this report/audit and purged after inspection. Unrelated out evidence was
preserved. The only integration-inventory addition owned by this review is one
literal assertion; its other existing changes were preserved. No source engine
or binding change was justified, and no Git/index/README mutation was performed.
