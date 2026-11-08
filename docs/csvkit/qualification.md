# Current qualification and outstanding tasks

**Current engine update:** see [implementation-status.md](implementation-status.md)
for implemented operations, safe-bash registration and new regression cohorts.
The foundation report below describes the earlier parser-only candidate and
is retained as historical evidence; its absence-of-engine statements no longer
describe the current working tree. Full requested compatibility remains unfinished.

## Earlier parser-only candidate

The requested compatibility suite is **unfinished**. No safe-bash csvkit
executables are registered and no CSV operation is implemented. The new private
domain workspace currently exposes argv ownership, an SDK parser, MatchFile
handle types and proposed execution interfaces. These are foundations, not
product parity or completed delivery.

## Measured reference and parser scope

* Authenticated csvkit 2.2.0 source archive and all 209 extracted source files;
  actual isolated CPython 3.9.6 and 3.14.2 installs; full installed version and
  requirement profiles, installed manifest hashes, verified dependency source
  artifacts and bounded interpreter binary hashes.
* Reference-only help, both version flags and one unknown-option error for each
  exact original executable: 112 observations, all expected statuses checked,
  56 exact version output checks. No command operation is included in this cohort.
* Parser code uses CPython 3.14.2 quoting choices 0–5 and the frozen C/80-column
  help/usage profile. The 3.9.6 profile is captured but not implemented as a
  selectable JavaScript parser profile.
* TDD covers raw byte distinction/ownership, count and byte admission,
  original-name versions, suppressed/common versus command-specific options,
  abbreviation/clusters/attached/equals/terminator arguments, repeated
  store/append/nargs behavior, negative tokens, Unicode decimal conversion,
  nonprinting diagnostic repr, malformed UTF-8 surrogateescape and cancellation.
* Independent-agent stress/fix reproduced six grammar/decoding/token mismatches;
  root added Unicode integer/diagnostic regressions and fixes. Independent
  recomputation confirmed all 76 decimal-zero, 25 integer-whitespace and 737
  nonprinting-range records against actual CPython 3.14.2 / Unicode 16.0.0.
* The initial FileType callback incorrectly read/copied content during parsing.
  Failing regressions reproduced the difference; the replacement opens a handle
  without reading, disposes exit/error handles and transfers parsed ownership
  through dispose(). Cooperative cleanup registration precedes acquisition and
  drains admitted pending opens. The actual host codec/locale/VFS behavior of
  MatchFile remains unqualified.
  Independent lifecycle stress/fix also prevents handing off an already closed
  scope and preserves primary cancellation/execution failures after awaiting
  cleanup. Tests cover failed/repeated opens, overwritten handles, shared dispose
  completion and observing all close failures.
* SDK csvcut help and unknown-option output were rendered through terminal-png
  and visually inspected. Wrapping/alignment remained readable without clipping.
  These are SDK output screenshots, not actual CLI/pipeline screenshots.

## Preparation and implementation limits

The source register inventories 415 parser action applications, 159 declarations,
323 conditions, 45 documentation inputs and 13,877 upstream test-function
declarations grouped across 367 files. Every upstream declaration remains mapped
to an explicit unported-operation blocker. No inventory member is counted as an
executed test. Parameterized/generated cases are not expanded; openpyxl/xlrd
reader test qualification and complete manual/changelog prose reconciliation
remain outstanding.

The original ordered plan remains unchanged. Reference acquisition is complete
for the two named profiles. Source register and architecture preparation exist;
the complete source-to-operation regression mapping and dependency/engine
qualification are still open. Domain scaffolding and parser work have begun.
The following task groups remain unfinished:

| Required scope | Current state |
| --- | --- |
| All14 operation executables and safe-bash command-family/export wiring | Not implemented or registered |
| CPython CSV reader/writers/sniffer/header selectors | Not implemented |
| Agate typed/null/Boolean/Decimal/date/datetime/duration/locale behavior | Not implemented |
| Every csvclean/cut/format/grep/join/json/look/sort/stack operation | Not implemented |
| Python regex semantics for csvgrep | Not implemented |
| csvstat's thirteen metrics plus raw count and all serializers/numerics | Not implemented |
| in2csv csv/dbf/fixed/geojson/json/ndjson/xls/xlsx | None implemented or operation-qualified |
| UTF-8/BOM/legacy codecs, gzip/bzip2/xz/optional zstandard | Not implemented or decoder-qualified |
| csvsql/sql2csv schema/insertion/query/transactions/persistence | Not implemented |
| Generic plus mssql/mysql/oracle/postgresql/sqlite DDL | Not implemented |
| Network drivers and dialect extension profiles | Absent from reference profiles; no product/service QA |
| csvpy standard Python objects/code.interact and optional IPython | Not implemented; safe-python's current public API alone does not qualify the required library bridge |
| Application/warning/verbose traceback/SIGPIPE/TTY diagnostics | Not implemented or qualified |
| SDK operation parity and finite invocation-wide budgets/stream isolation | Proposed interfaces only; not enforced by an execution engine |
| Full original/differential/shell/VFS/service/interactive/visual/consumer QA | Not executed |
| Full independent-agent stress/fix of implemented safe-bash CSV tools | Not executed; current independent work covers the SDK parser only |
| README and root lock/integration/public-consumer delivery | README draft only, publication requires permission; root integration untouched |

The Node 22.22.2 memory SQLite probe reports real SQLite 3.51.2, differing from
reference SQLite 3.50.4 and 3.43.2. That probe does not qualify arbitrary queries,
transactions, cancellation or authorized VFS persistence. The proposed ssconvert
workspace is absent; office-package's public ZIP/gzip exports are not an XLS/XLSX
reader. No product native-process/Python fallback exists.

The parser is not exhaustively qualified against all argparse paths. Explicit
exported input-encoding defaults, native integer digit limits, actual match-file
codec errors and every per-command application validation/timing path still need
ordered implementation and differential coverage. Matching stored help text does
not qualify those paths. Context interface declarations do not grant or enforce
filesystem/network/database/interpreter access or budgets.

No README additions, commits, pushes, releases, staging changes or root integration
edits have been made. Existing untracked csvkit/ssconvert plans are preserved.
Maintained focused workspace tests/build/lint are the verification route for the
implemented domain scope; no full-root or safe-bash operation gate is claimed.
The final uncached selected workspace build, all 26 in-memory tests and workspace
ESLint/source/test typechecks passed. Repository-local Git hook environment keys
were removed from the test child environment without changing the parent or
global/private Git configuration.
Owned reference sources/environments, research helpers and SDK screenshots were
purged after reduction; maintained documents preserve the measured scope, hashes,
observations, failures and limits. No unrelated out content was removed.
