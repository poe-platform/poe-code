# JavaScript SQL transport validation

The implementation adds explicitly injected PostgreSQL, MySQL, MariaDB, MSSQL
and Oracle transports to the shared csvkit engine. Compiler availability and
driver capability are separate. No transport loads a driver module, accesses
ambient credentials or starts a product subprocess. The source/profile remains
csvkit 2.2.0, archive SHA-256
147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b.

Original failing regressions established network insertion refusal, rejected
sql2csv default streaming options, lost native temporal/numeric identities,
missing decoder metadata and MSSQL DATE conversion. The independent stress
agent additionally reproduced premature iterator disposal, metadata-acquisition
cursor leaks and lost cleanup-error identities. Fixes preserve partial stdout,
completed effects and cooperative cleanup ordering; they do not promise that
cancellation can undo database effects.

Native scalar codecs receive typed date/datetime/decimal/float records before
lossy conversion. Buffered result decoding receives original field metadata.
Native numeric results without an explicit codec are refused; driver acquisition
must select precision-safe fetch representations. Injected streaming cursors
own their independently qualified scalar conversion.

Canonical tests use in-memory inputs and injected recording transports, without
host file creation, subprocesses, network, LLMs or slow services. Nine independent
actual Shell network/lifecycle stress cases pass after rebuilding the public
engine. Final maintained uncached csvkit unit replay passes 83 files and 4,065
tests, with one skip and six TODOs (4,072 total). Maintained csvkit lint, selected
safe-bash workspace build closure and final focused scalar regressions pass.
The safe-bash runner suite passes 536 tests. Repository type lint, workflow lint
and guarded ESLint completed successfully; ESLint measured 15,986 subjects,
zero errors and two warnings. Earlier full CSV/in2csv Shell replay measured
1,943 passing cases, one
skip and one TODO; it included adjacent CSV commands and is not a csvkit
compatibility denominator. Adhoc screenshots were generated through the
maintained renderer and visually inspected, showing streamed PostgreSQL CSV
and frozen MariaDB missing-driver diagnostics. These are not service QA.

The first broad npm test invocation reported timeout failures across several
workspaces while concurrent checks were active. It was stopped after those
concrete failures; no completed total or passing full-run claim applies to it.
A second uncached normal npm test invocation, with no concurrent heavyweight
checks launched by this task, still reported timeouts in safe-python ISO-2022-JP,
UTF-7 recovery and EUC-KR cases. It was stopped after those concrete failures,
without completed totals. The experimental one-worker local configuration was
removed because it did not resolve the failures. The broad gate remains
unresolved; an isolated successful replay does not resolve it. A domain run
also reported a workbook differential timeout; its regression and the final
maintained package replay are tracked separately from native scalar fixes. The
final maintained domain run with the original worker configuration passes that
case and the complete domain suite; it does not resolve the full-run failures.

## Explicit blockers

No PostgreSQL/MySQL/MariaDB/MSSQL/Oracle service or exact JavaScript/native
driver deployment was configured for this task. Real catalog visibility,
server-side cursor cancellation, unique/null/length enforcement, transaction
effects and prefix expressions remain unmeasured. Source-only SQLAlchemy bind
processor captures and missing-driver CLI differentials in
sql-network-source-reference.json do not install or qualify a DBAPI driver.

Exact SQLAlchemy/DBAPI diagnostic codecs remain deployment-injected and
unqualified. Native bulk/executemany optimization and nontransactional partial
batch equivalence, unusual schemas/catalogs, exact native driver artifacts and
scalar codec profiles require additional named qualification. Third-party
dialects/options need explicit additional providers. Verbose Python tracebacks
and the wider suite's skips/TODOs/common-profile gaps remain blockers. This
implementation does not establish complete csvkit parity.

The optional authorized service QA procedure is in
docs/plans/csvkit-network-transports.md; APIs/configuration are in
docs/specs/csvkit-javascript-transports.md. No README content, Git staging,
commit, push or publication is authorized or performed.
