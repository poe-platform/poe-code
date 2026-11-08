# Explicit JavaScript SQL transports

`createSqlTransportProvider` is exported from the csvkit workspace and the
existing `poe-code/csvkit` public domain export. Pass the resulting provider to
both SDK `databases` and safe-bash `csvkitCommands({ databases })`; both execute
the actual csvsql/sql2csv engine. All fourteen executable names and their argv
syntax remain intact. Default registration grants no driver or network access.

## Profiles and acquisition

The generated `sqlTransportProfiles` inventory discovers one descriptor file
per profile. No engine branches on provider names. Compiler availability,
connection acquisition, reflection, insertion and server cursors are distinct
capabilities. The frozen baseline profile has no network DBAPI drivers; its
missing-driver errors remain exact, including MariaDB URL aliases. JavaScript
transport profiles are additional named contracts, not evidence that absent
Python drivers were installed or that a service was measured.

| Profile | Injected native API | Parameters | Result mode |
| --- | --- | --- | --- |
| postgresql-pg-cursor-v1 | pg client, explicit cursor factory | $1, $2 | explicit server cursor, array rows |
| mysql-mysql2-v1 | mysql2 promise connection | ?, ? | array rows/fields; streaming requires explicit cursor |
| mariadb-node-v1 | MariaDB promise connection | ?, ? | array rows/paired metadata; streaming requires explicit cursor |
| mssql-node-v1 | transaction and request factories | @p1, @p2 | arrayRowMode; streaming requires explicit cursor |
| oracle-oracledb-v1 | Oracle connection/resultSet | :p1, :p2 | outFormat ARRAY, resultSet, autoCommit false |

The five additional positional/named profiles accept the lower-level
`SqlTransportConnection` interface, including optional actual executemany.
They are useful for independently reviewed transports, including exact batch
semantics not expressible through a driver's scalar API. A configured native
adapter without executemany executes bound rows individually; native bulk
statement/driver optimization and nontransactional partial-batch equivalence
are **unqualified**, not claimed by these adapters.

Choose one explicit `connect` function or `driver`, never both. `driver.acquire`
receives the authorized parsed request and signal; `driver.release` owns the
native connection/pool release. No native package is imported, installed or
loaded here. The host supplies its actual initialized driver infrastructure.
For PostgreSQL, cursor capability is checked before acquisition. Unsupported
stream requests never silently fall back to buffered queries.

`authorize` must return true for every endpoint selected by the URL, its query
and reviewed mapped engine options, including secondary hosts and sockets.
Credentials are explicit URL/configuration identities and never read from the
environment. Authorization precedes acquisition. The adapters have no ambient
filesystem/network credentials, executable fallback or subprocess path.

For a third-party deployment, supply a separately named `transportProfile` and
matching `compiler`, plus the explicit connection binding and authorization.
Unreviewed engine/execution options remain capability failures. Option mappings
must review actual semantics, not merely rename fields. `stream_results` is a shared Boolean execution option mapped automatically to
`stream_results`, including sql2csv's default True. An explicit mapping must
preserve its target and Boolean identity; it cannot silently turn streaming
off. `no_parameters` retains the shared Boolean control. Native adapters
explicitly refuse False because DBAPI parameter interpolation is unqualified;
a separately reviewed lower-level transport can implement that profile. Native
APIs reject additional mapped execution options they do not implement; explicit
host cursor bindings receive independently reviewed cursor options. Native positional transports have no Python percent
interpolation. Schema-only compiler output keeps frozen DBAPI percent escaping.

## Reflection, constraints and scalar values

The shared engine preserves reflected overwrite/drop/create,
create-if-not-exists, no-create, schema selection, insertion prefixes and chunk
boundaries. PostgreSQL checks catalog relation visibility and explicit schemas.
MySQL/MariaDB use quoted DESCRIBE, which includes session temporary tables;
only native errno1146 denotes absence, while permissions/other errors propagate.
MSSQL supports current or explicit database/owner catalogs and tempdb object
visibility. Oracle uses owner-qualified table/view catalogs and denormalizes
ordinary unquoted identifiers while preserving quoted reserved/mixed-case names.
These are source/interface unit qualifications; live server semantics remain
unmeasured, including catalog visibility, synonyms, unusual multipart names,
permissions and database collation.

DDL carries unique constraints, null requirements and text lengths into the
actual service. JavaScript does not simulate their enforcement or undo completed
DDL. Driver/server failures retain effects already completed. Exact server SQL
modes, collation, transactional DDL and driver executemany behavior need a named
service profile. Absence of such QA is never a pass.

PostgreSQL Boolean parameters stay Boolean, while MySQL/MariaDB/MSSQL/Oracle
use numeric Boolean bind semantics. Decimal text retains arbitrary precision;
driver encode/decode callbacks qualify native representations and reference
result types. PostgreSQL intervals retain exact signed microseconds; emulated
MySQL/MariaDB/MSSQL Interval values use epoch datetimes with six fractional
digits and reject out-of-range values. Native date/datetime parameters retain
typed semantic objects and require an explicit exact `driver.encode` codec;
native Decimal and float records likewise remain distinct from plain text,
including integral floats, so codecs can select precision-safe driver types.
MSSQL DATE becomes a midnight datetime as in the frozen pyodbc processor.
Oracle intervals also retain semantic types. No default JS Date conversion
silently drops microseconds. Native numeric results and unsupported objects
require `driver.decode(value, column, metadata)`, rather than guessing Python
int/float/Decimal identity. Buffered adapters pass original field metadata;
injected cursors own their metadata and scalar conversion. Acquisition must
configure precision-safe fetch types before decoding: a decoder cannot restore
precision already lost by the native driver. String/Boolean/bigint/null/byte
outputs retain their identity; result labels retain order and duplicates.

An optional `diagnostic(error, sql)` codec must qualify the exact deployment's
SQLAlchemy/DBAPI exception class/detail/SQL/parameter representation. Unknown
native errors without that codec return status78 with an explicit driver
qualification diagnostic. They do **not** claim default driver-error parity.
Verbose Python tracebacks, per-driver error codecs, native decimal/date result
identity, actual driver/module/version pins and live service interoperability
remain blockers until measured in separately named deployment profiles.

## Resource ownership

The engine enrolls invocation cleanup before provider acquisition. Late canceled
acquisition rolls back and releases the native connection before propagating
the original abort reason, including falsey values. Adapter operations close
admission synchronously and drain admitted work. Failed metadata transfer
cancels/closes the acquired cursor; cleanup failures retain all error identities.

Cursor reads are sequential, copy retained byte values, retain duplicate labels
and await output backpressure. Cancellation requests cursor interruption before
draining pending reads and disposing the result/connection. Final csvsql iterator
return settles before result close and commit. csvsql commits successful output;
failures roll back, while sql2csv rolls back its implicit transaction. Completed
commit/DDL/output effects are never represented as undone. Cancellation cannot
preempt an uncooperative native driver; explicit cancel/close callbacks must
cooperate and safely handle idle resources. A returned host binding is trusted
JavaScript, not a sandbox guarantee.

## Configuration and QA

Configuration fields: profile, transportProfile, compiler, connect or driver,
authorize, credentials, engineOptions, executionOptions and diagnostic. Native
driver fields: acquire, release, optional cancel, cursor, encode, decode,
transaction and request. No environment variables are exposed by these adapters.
The native driver version, service version, options, codecs, authorization and
credentials belong to the configured deployment profile; they are not discovered
from the machine. Package README content was not added because permission is
required; this specification documents configuration independently.

The optional real-service QA procedure is
`docs/plans/csvkit-network-transports.md`. No service/driver endpoints were supplied
for this implementation. PostgreSQL, MySQL, MariaDB, MSSQL and Oracle service
interoperability is **unmeasured**. In-memory driver/interface tests are canonical
unit tests and never substitute for these services or the frozen native comparator.
