# Optional-profile interoperability continuation, 2026-09-19

This continuation extends the existing TypeScript ESM domain engine and explicit
safe-bash fourteen-command family. It does not complete csvkit 2.2.0 compatibility.
Root and scoped instructions were read; existing edits and staging were preserved.
No README additions, commits, pushes or publication were performed.
The agent-executed procedure is
[the optional-profile QA plan](../plans/csvkit-optional-profile-interoperability-qa.md).

## Reference authentication and limits

The source archive was independently streamed and authenticated again: 3,820,365
bytes, SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The reference interpreter is the canonical CPython 3.14.2 binary, 49,968 bytes,
SHA-256 `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`.
Native subprocesses are isolated oracles, never product fallbacks. Native inputs,
SQLite databases and side files were created only below owned `out` scratch;
Python bytecode writes were disabled. Locale, UTF-8, UTC, terminal dimensions
and pipe stream observations are recorded with installed-file manifest hashes.

The live installation matches the frozen runtime and SQLAlchemy 2.0.54, Agate
1.14.2, openpyxl 3.1.5, dbfread 2.0.7 and most dependency file manifests. Babel,
csvkit, python-slugify and xlrd installed-file manifests differ, and frozen pip
is absent. These differences were retained, rather than normalized or repaired
by changing someone else's environment. This run therefore records observations
under a separately identified installed tree; it gives no qualification credit
to the complete original frozen installation. Version equality alone is not
installed-file identity.

[Pre-fix evidence](optional-profile-interoperability-20260919.json) preserves
the original parameter diagnostic failure, actual inputs/output/status and
independent database-header observations. Database values and schema matched,
but pre-fix file hashes and transaction counters differed. These are historical
failures, not a current passing cohort.

## Regression-driven changes

A different agent independently reproduced four streamed side-file failures.
Encoding individual UTF-16 fragments split a surrogate pair into replacement
characters and charged six output bytes instead of four. The streaming path now
holds a terminal high surrogate until its successor arrives, preserving joined
UTF-8 bytes, output admission, awaited writes and registered idempotent closure.
Seven original in-memory cases cover paired/unpaired surrogates, empty fragments,
exact budgets and denial before publishing a pair.

Genuine native csvsql persistence exposed missing SQLAlchemy parameter lists in
failed SQLite insertion diagnostics. The independent agent reproduced original
one-, two- and twelve-row failures before adding SQLite batch execution and
bounded tuple/list parameter rendering. Boolean bindings now retain native integer
identity, distinct from floating Number bindings. Actual public safe-bash replay
also matches one-, twelve- and thirty-row native stderr, stdout and status,
including Python quote selection and first-eight/last-two batch truncation.
Every replay independently checks that failed inserted rows were rolled back.

Independent database-byte inspection then exposed eager physical BEGIN in the
SQLite provider. The native SQLAlchemy/pysqlite legacy profile begins logically
before DDL and physically only when DML requires it. Consequently native csvkit
retains a newly created table after a duplicate insertion fails. The provider
now represents logical transaction state and preserves explicit SQL BEGIN;
the original DDL-survival failure is covered by an in-memory regression.

## Genuine optional-profile observations

The corrected cohort includes thirteen XLSX executions, six XLS executions and
eleven DBF executions. Each compares exact stdout/stderr/status and complete
file effects with native in2csv. openpyxl and xlrd independently inspect workbook
cells, types, cache values, sheet selection, dimensions and epochs. Cohorts cover
1900/1904 date systems, mixed dates/errors, zero/time serials, malformed dimension
metadata with/without reset, cached and uncached formula values, relocated
relationships, active-sheet selection and written sheet files. dbfread independently
checks memo payloads and cp1252/cp437/cp850/Mac Roman decoding, including a real
DB4 memo payload and FoxPro numeric field with its memo file.

SQLite persistence uses an explicitly injected 3.50.4 WASM engine and authorized
memfs VFS. The WASM binary hashes to
`3c924f7de0fd0979da11615be99ec826a066f8fc804a91c3ec9c45b7d8f1655f`.
CPython SQLite and WASM share source revision
`2025-07-30 19:33:53 4d8adfb30e03f9cf27f800a2c1ba3c48fb4ca1b08b0f5ed59a4d5ecbf45e20a3`.
CPython sqlite3 and `/usr/bin/sqlite3` independently read exported JavaScript
database files and verify integrity, schema and committed Unicode values.
An independently authored CPython database is imported into memfs and read by
the product provider. SQL upper/length/json_extract/printf results, constraint
failures, DML rollback and reopen are observed separately. Actual native/product
csvsql commands compare query bytes and failed insertion effects; database schema
and typed values are independently inspected instead of inferred from CSV shape.

Native gzip/bzip2/xz compression is independently produced from deterministic
UTF-8 CSV. Injected JavaScript gzip yields identical csvcut bytes/status/stderr.
Native bzip2/xz succeed while the shipped JavaScript capabilities return status
78: those are explicit failures, not compatibility passes. No zstandard module
exists in the reference installation; the independent host zstd executable does
not establish a csvkit zstd profile or shipped decoder.

Genuine native csvpy reader/dict sessions and injected JavaScript sessions match
namespace operations, iteration, physical line number, prompts, banner, EOF and
stdout/stderr/status. Each guest closes exactly once. Native Agate Table mode
succeeds where JavaScript returns status 78 for the missing qualified object
library. IPython is absent. Arbitrary Python/Agate semantics and TTY/IPython remain
unverified. SQLAlchemy's native regexp succeeds but the shipped SQLite provider
explicitly refuses that function; the four measured scalar functions are no
universal SQL-function claim. SQLite returned-row executemany, extension loading,
URI/options profiles and native disk durability remain unqualified.

No PostgreSQL/MySQL/MariaDB/MSSQL/Oracle service endpoint or credentials were
supplied. Reference psycopg2/pymysql/MySQLdb/pyodbc/oracledb modules are absent.
Real driver options, server cursors, service errors and rollback remain explicitly
unverified; mocks were not credited as genuine service acceptance. No implicit
network/database discovery was performed. Workload performance remains unmeasured
because the complete frozen installation and unsupported operation profiles do
not pass equivalence qualification.

## Checks, visual inspection and scratch discipline

The independent maintained domain route passes 4,407 tests across 101 files with
five existing TODO excluded, after the streamed-byte and parameter corrections.
Domain lint and the selected maintained uncached build closure pass. Root actual
safe-bash workbook/output ownership checks pass 73/73; rebuilt SQLite lifecycle,
csvsql and output ownership checks pass 39/39. These focused checks do not
supersede the previously recorded full-repository acceptance blockers.

The actual registered safe-bash csvsql error output was captured through public
SDK bindings with the maintained screenshot runner and opened for inspection.
One-row and batch parameter diagnostics are readable and preserve raw upstream
formatting. An initial capture mixed source-module providers with built public
engine classes and produced an internal-error harness observation. Rebinding
through the public SDK corrected that setup; the failed capture was not credited.
Initial package-fixture filename mapping and interpreter-session wrapping errors
were likewise corrected before crediting the successful observations. A 2 MB
source-inventory cap rejected the 2,041,662-byte Unicode data file; the retry uses
a bounded 3 MB per-file admission. None of these incomplete attempts is a pass.

## Final replay

[Final reduced evidence](optional-profile-interoperability-verified-20260919.json)
records actual input/effect/source hashes and the stable installed reference tree.
The complete probe is identical before and after native execution, SHA-256
`c2d88b723bdd2892d178c085b21efe2ec7f615c3ee5929a08795f92ee99f9c70`.
The declared source/test inventory contains 2,388 admitted TypeScript files below
csvkit, safe-python and office-package. Its hash is identical before/after replay:
`9733e7b428faab91c5efc134f652261849c79a85fa11f1fcda308bf8c5a180be`.
The evidence defines path ordering/serialization and records each edited file's
actual SHA-256. This identifies dirty worktree inputs, not a committed release.

All thirty workbook/DBF conversions match native stdout/stderr/status and file
effects. Gzip, csvpy reader/dict and csvsql successful/failed insertion transcripts
also match; bzip2/xz and csvpy Agate remain the three measured capability failures.
Real server services, zstandard, IPython and complete frozen-installation identity
remain unavailable or unverified, outside the passing denominator.

After the legacy transaction correction, the successful native and product
database files are byte-identical, SHA-256
`7edd3dfe537b3c29e68867d534976b0accec2a57dcea3beaa9c1b27afd5ee47e`.
The failed initial insertion retains the same table/index definitions and zero
rows in both engines, with byte-identical database files, SHA-256
`0f7470a5c7336aa0860e1e9e90445460cb7b26949979bdeea813d6f62d0caae0`.
One/twelve/thirty-row public safe-bash parameter replays still match exact native
output and rolled-back rows; their persisted database bytes now match too.
No journals remain in the owned product VFS namespace.

Final maintained domain checks pass 4,410 tests across 102 files, with five TODO
excluded. Domain lint passes; root reran the selected maintained uncached csvkit
build closure successfully after the transaction fix. Rebuilt actual safe-bash
SQL lifecycle/csvsql/output ownership checks pass 39/39. Earlier workbook/output
ownership checks pass 73/73. Public domain and safe-bash export inventories match
the independently declared original fourteen executable names exactly. No
repository-wide gate or release is claimed.

Only this continuation's owned `out/csvkit-optional-sept19` scratch was purged
after reduction; all pre-existing `out` artifacts remain untouched.
