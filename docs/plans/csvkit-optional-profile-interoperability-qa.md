# Optional csvkit profile interoperability QA

Execute against the current working tree, preserving unrelated edits and staging.
Never commit, publish, add README content or enable ambient product capabilities.
Native programs are isolated observers, never product fallbacks. Scratch inputs,
databases, captures and execution aids belong in unique owned `out` directories.

1. Authenticate the csvkit source archive against the requested SHA-256. Resolve
   the supplied reference interpreter, hash its bounded binary bytes without
   decoding them, and compare runtime and all installed distribution versions
   and non-pyc file manifests with the frozen profile. Retain installation-path
   manifest drift as a qualification blocker rather than normalizing it away.
2. Execute an injected SQLite WASM provider with authorized memfs persistence.
   Export committed database bytes into owned scratch. Independently inspect
   integrity, schema, values and transaction effects with CPython sqlite3 and
   the system sqlite3 utility. Import an independently authored SQLite database
   into memfs and exercise SQL functions, failed constraints, rollback and reopen.
   Compare native csvkit commands and database effects, including DDL survival
   and rollback of DML. Record engine/source revision differences explicitly.
3. Materialize deterministic existing XLS/XLSX and DBF memo/codepage cohorts
   in isolated scratch. Inspect workbooks with openpyxl/xlrd, DBF with dbfread,
   and execute native in2csv with original argv. Compare exact stdout, stderr,
   status and file effects with the injected JavaScript engine. Verify cached
   values, dates, sheets, dimensions, memo payloads and decoded records rather
   than inferring them from CSV shape alone. Authenticate cohort input hashes.
4. Independently produce gzip/bzip2/xz streams and inspect decompressed bytes.
   Compare native csvcut with explicit JavaScript providers. Missing shipped
   decoders remain unsupported even if native csvkit succeeds. A zstd module
   absent from the frozen interpreter is an absent profile, not zstd coverage;
   an installed independent zstd executable does not qualify product support.
5. Exercise csvpy reader/dict through an explicitly injected JavaScript session,
   comparing namespace operations and observed console effects with native
   csvpy. Agate library and IPython profiles require their actual libraries and
   interpreter behavior. Missing libraries/TTY profiles remain unverified.
6. Connect only to explicitly supplied disposable core database services and
   drivers. Check driver options, cursor fetches, transactions, error rollback
   and independent database reads. No configured endpoint or credentials means
   unavailable, not a mock-service pass. Never search for ambient credentials.
7. Only benchmark cohorts whose exact semantic/byte/effect comparison passes
   under authenticated profiles. Use bounded deterministic inputs, actual source
   and input hashes, alternating execution order and bounded repeats. Leave
   performance unmeasured when profile/equivalence qualification fails.
8. Run maintained uncached domain build, unit and lint routes, then relevant
   safe-bash registration/cleanup tests. A separate agent stress-tests/fixes
   implemented tools using failing in-memory regressions. Root owns integration,
   exports and Git. Broaden checks only when shared code or integration changes.
9. Reduce outcomes, exact denominators, hashes, failures and blockers into
   `docs/csvkit`; purge only this procedure's scratch after reduction. CLI visual
   changes require ad hoc screenshot inspection. Refusals, TODOs and unavailable
   profiles never count as compatibility passes.
