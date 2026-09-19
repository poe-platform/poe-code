# SQL database capabilities

The csvkit domain workspace exports parseDatabaseUrl, resolveDatabaseProvider
and createDatabaseProvider. Both original SQL executables and the SDK use the
same URL resolution and operation engine. There is no subprocess, Python
fallback, implicit driver loader, ambient credential lookup or automatic
network grant. Shipped dialect descriptor files supply compiler metadata,
driver registry and validation; build-time discovery supplies registration and
csvsql help choices without provider-name branches in core.

SQLAlchemy-style URL identity differs from WHATWG URL identity. Credentials
are percent-decoded with UTF-8 replacement; query pairs decode plus/percent,
omit blank values and preserve duplicate order. Database paths are literal,
including percent escapes. IPv6 brackets delimit the host. Database fragments
are ordinary database/query characters. SQLite null, empty and :memory: paths
select separate memory connections; relative and absolute paths retain their
identity and resolve only through the injected VFS/invocation cwd.

DatabaseProviderDescriptor explicitly binds schemes, deployment profile,
local/network transport, authorization and connection acquisition. Every
connection request includes the parsed URL, explicit credentials, mapped
engine options and invocation cwd. Authorization must inspect every endpoint
selected by URL query values or mapped driver options (including secondary
hosts/socket routes). A true decision is required before acquisition. The
authorizer and driver receive the invocation AbortSignal. Trusted host adapters
must implement endpoint enforcement, cancellation and failed-acquisition
cleanup; this interface cannot sandbox arbitrary host JavaScript or terminate
uncooperative driver work.

URL credentials form one identity. A URL username/password never borrows the
password/username of the separately bound configured identity. Only a URL
with no credential fields receives the explicit descriptor credentials;
without either binding both fields are null. No environment or global config
is read. Credentials and raw URLs are sensitive host inputs, not logging data.

Each supported option has a reviewed target and conversion. The factory
forwards only these mapped fields and rejects every other engine/execution
option with an explicit capability diagnostic. The driver binding must actually
implement the declared semantics: renaming a field alone does not qualify an
option. Target names must be unique. The shared SQLAlchemy no_parameters
execution default remains a Boolean control; raw user dictionaries never
become arbitrary constructor arguments. Existing low-level DatabaseProvider
bindings remain an explicitly trusted escape port whose host owns all option,
credential and authorization policy; they are never created by default.

The SQL operation resource scope enrolls before connection/result/iterator
acquisition. It drains registered cooperative work and closes results before
rollback/session close. csvsql commits only after successful effects/output;
sql2csv closes its implicit transaction by rollback. Late cancelled factory
acquisition rolls back and closes before propagating the exact original abort
reason, including falsey reasons. Rollback failure still permits close. Query
options are mapped before driver query/result acquisition; malformed sql2csv
execution literals occur after connection acquisition and query input, matching
the reference ordering. Driver result labels, duplicate labels, types and row
order pass through without name deduplication or inference.

Frozen driver-absence diagnostics are csvkit's create_engine ImportError
wrapper, not the Python module's original message. Unknown dialect/driver
plugins use NoSuchModuleError. Reference-available SQLite without an explicit
binding remains a declared capability difference (status78). Invalid SQLite
authority is diagnosed before the missing binding. Verbose Python tracebacks,
real network driver services, URI/query SQLite features, Unicode driver-name
grammar and unmeasured malformed URL profiles remain blockers. SQLite invalid
credential URL rendering remains blocked to avoid inventing redaction/escaping.

SQL literal options support qualified Boolean/None/numbers/strings, nested
lists, frozen SqlTuple values, Sets, string-key dictionaries and mixed-key Maps.
Python numeric/Boolean key equality and duplicate-key precedence are preserved.
Qualified ast ValueError expressions stay byte-for-byte raw strings, with no
evaluation or callback invocation. Measured SyntaxError cases retain exact
nonverbose class/detail/status; other syntax, complex/bytes/Ellipsis literals,
unhashable-key TypeError diagnostics, named/unknown string escape and
warning profiles remain explicit blockers. See sql-container-options-reference
and sql-syntax-options-reference in docs/csvkit. Product resource bounds are
declared differences rather than Python completeness claims. Literal parsing,
hashability and Python key-equality comparisons consume the shared command work
budget; direct sqlOptions calls without an injected work callback have a
100000-operation bound. Excessive port-integer diagnostics remain blocked.
An exhausted shared work budget also blocks diagnostic writes; that resource
profile returns status78 with empty stderr rather than claiming native parity.

Adjacent ordinary, Unicode-prefixed and raw string tokens concatenate as Python
constants, including in lists, tuple values and dictionary keys. Comments and
physical newlines between tokens are admitted inside bracketed expressions;
top-level multiline diagnostics remain unqualified. String addition still falls
back to the original raw expression on ast.literal_eval ValueError.
