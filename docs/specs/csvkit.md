# csvkit 2.2.0 compatibility target

The product target is a TypeScript ESM JavaScript implementation of the fourteen
original executables: csvclean, csvcut, csvformat, csvgrep, csvjoin, csvjson,
csvlook, csvpy, csvsort, csvsql, csvstack, csvstat, in2csv and sql2csv. No product
command may launch installed csvkit, CPython or another native utility. Native
csvkit is an isolated reference only.

## Authenticated reference

`docs/csvkit/reference-profile.json` records the checksum-verified PyPI source,
two actual isolated installs, exact distribution versions and requirements,
published source artifact hashes and installed-content manifest hashes.
`source-manifest.json` authenticates all 209 files extracted from the source
archive. Distribution manifest hashes use the documented canonical JSON domain;
their installation-specific script paths prevent treating them as universal wheel
hashes. Source artifact hashes and installed manifest hashes are separate facts.

`oracle-3.9.6.json` and `oracle-3.14.2.json` preserve stdout, stderr and status for
each executable with `--help`, `-V`, `--version` and an unknown option: 56
observations per profile, 112 total. Input is an empty noninteractive pipe;
locale is C, timezone UTC, output UTF-8 and terminal width 80. This capture does
not qualify interactive terminals, drivers, command operations or product parity.

Both installs accept Agate 1.14.2, agate-excel 0.4.2, agate-dbf 0.2.4 and
agate-sql 0.7.3. CPython 3.9.6 resolves python-slugify 8.0.4 and the
importlib-metadata/zipp compatibility dependencies; 3.14.2 resolves
python-slugify 9.0.0 and does not require that compatibility pair.
python-dateutil, zstandard, IPython and network database drivers are absent in
these profiles; a historical changelog reference does not make dateutil a
current installed dependency. Optional installations require separate profiles.

## Runtime-dependent semantics

The source computes argparse quoting choices from the runtime's `csv.QUOTE_*`
constants (`csvkit/cli.py:29`). CPython 3.9.6 exposes 0–3; 3.14.2 also exposes
QUOTE_STRINGS=4 and QUOTE_NOTNULL=5. Help prose still describes only 0–3. Preserve
that source/runtime distinction rather than changing the help or rejecting
choices accepted by the selected profile.

The common input opener is lazy; file iteration strips NUL whereas delegated
bulk reads do not (`cli.py`, LazyFile). csvgrep's argparse FileType match file
opens eagerly. `stdinIsDefault` does not establish TTY provenance. Product I/O
requires explicit VFS, stream, terminal, encoding, clock and locale bindings.
Database and interpreter access require explicit capabilities without ambient
credentials or automatic engine loading.

Raw readers and typed Agate tables are separate semantic paths. csvcut pads
missing selected fields with null and writes the selected header first.
csvgrep gives a nonempty regex precedence over a match file and then a string;
match-file lines use rstrip, including whitespace beyond line separators.
csvformat switches to typed Agate loading for output quoting 2, even though
inference flags are suppressed. Its ASV mode overrides delimiter and record
terminator. These source observations require original differential regressions
before corresponding product work.

## Acceptance and remaining work

Every source test must map to an original in-memory canonical test, isolated
oracle/service QA or a named blocker. Preparation inventories are never passes.
Compare deterministic output bytes, diagnostic channels/status, VFS changes and
database effects; record runtime-specific paths and capability divergences.
All eight in2csv formats, Agate inference/numeric/statistical behavior, SQL
transactions/dialects, Python interaction and optional profiles remain required.

The verified Babel 2.18.0 source and its runtime API identify CLDR 47. Both
runtimes report bzip2 1.0.8 and liblzma 5.4.3 through their linked-library
version functions; SQLite/zlib versions are recorded separately per profile.
TTY/SIGPIPE behavior and real database/interpreter profiles remain unmeasured.
The complete feature register, engine qualification,
JavaScript product implementation and independent-agent stress/fix are not yet
complete. No compatibility claim follows from reference acquisition.

## Independently requalified reference

The 2026-09-17 research pass preserves the existing profiles and captures.
`docs/csvkit/reference-requalification-20260917.json` independently verifies the
archive, all 209 extracted source-file hashes, both active dependency closures,
both interpreter executable hashes and all 112 original observations. It also
retains every non-pyc installed distribution file/hash record, actual selected
wheel URLs/hashes, 48 verified source/wheel/tool artifacts, 56 additional parser
error observations and eight command quoting observations. These are native
reference measurements; this pass changes no product code.

`requirements-cpython-3.9.6.txt` and `requirements-cpython-3.14.2.txt` under
`docs/csvkit` freeze the active runtime dependency closures with artifact hashes.
The original installed-content digests remain unchanged. Installation-specific
RECORD, direct_url metadata and generated executable scripts can change those
digests even when the authenticated package sources and command bytes match.
The requalification records its own complete installed manifests separately.
Installer/build tooling is separate from the runtime closure: the 3.9.6 recheck
uses pip 25.3 instead of the original pip 21.2.4. WHEEL metadata identifies
setuptools 82.0.1 on 3.9.6 and 84.0.0 on 3.14.2; transient build inventories were
not retained, so reproducible wheel builds are not claimed.

The measured process environment contains only PATH=/usr/bin:/bin, LC_ALL=C,
LANG=C, TZ=UTC, PYTHONIOENCODING=utf-8, COLUMNS=80 and LINES=24. It supplies empty
stdin through a pipe and collects stdout/stderr independently as bytes before
strict UTF-8 decoding. There is no inherited Python startup, search-path,
unbuffered, warning or terminal environment override. Both runtimes report C
locale, UTC and UTF-8 mode enabled. Input/output use strict UTF-8; stderr uses
UTF-8 with backslashreplace and line buffering. Output is buffered, not line
buffered; write-through is disabled. The reported terminal width is the configured
80-column parser rendering profile, not a measured TTY width.

CLI input encoding and typed number locale are separate settings. The pinned
source defaults `--encoding` from PYTHONIOENCODING, falling back to utf-8-sig
when absent (`cli.py:207`); `--locale` defaults to en_US (`cli.py:211`). This
reference therefore measures an explicit UTF-8 input default, not the absent-env
BOM-stripping default. Babel 2.18.0/CLDR 47 data are included in the installed
file manifests. Date parsing uses parsedatetime, ISO datetime fallback uses
isodate, and durations use pytimeparse; python-dateutil is absent. Dependency
source locations and hashes are listed in the accompanying research note.

Decimal context is unchanged by importing csvkit/Agate/SQLAlchemy: precision 28,
ROUND_HALF_EVEN, Emin=-999999, Emax=999999, capitals=1, clamp=0, with
InvalidOperation/DivisionByZero/Overflow trapped and no flags set. libmpdec is
2.5.0 on 3.9.6 and 4.0.0 on 3.14.2. This freezes an initial context; it does not
establish statistical or rounding parity for individual operations.

The runtime CSV probes distinguish unquoted empty fields from quoted empty
strings under QUOTE_NOTNULL=5 on 3.14.2: None writes an unquoted empty field and
reads back as None; an empty string writes quoted empty and remains empty text.
QUOTE_STRINGS=4 quotes strings and reads unquoted numbers as floats. In the
recorded mixed row, unquoted True raises ValueError when read under choices 2
or 4. Four concrete command invocations per runtime confirm that csvcut input
quoting and csvformat output quoting accept 4/5 on 3.14.2 and produce parser
status 2 on 3.9.6. These fixtures qualify only their recorded inputs.

Initial warning filters and the filters after imports are retained. parsedatetime
adds default pdtDeprecationWarning and ignored pdtPendingDeprecationWarning
filters. csvkit locally suppresses Agate's “Column names not specified” warning
under no-header mode (`cli.py:142–145`). Help/version observations emit no
warnings; operation warnings and verbose tracebacks need separate qualification.

The optional profile is explicitly **absent** for zstandard, IPython,
python-dateutil, network DBAPI drivers and external SQLAlchemy dialect entry
points. stdlib sqlite3/pysqlite and the shipped dialect names are identified,
but identifying a dialect does not demonstrate working database access.
SQLite remains 3.43.2 on 3.9.6 and 3.50.4 on 3.14.2; zlib is 1.2.12, bzip2
1.0.8 and liblzma 5.4.3 on both. Linked-library inspection and version functions
support those compression identities; OS shared-cache bytes are not archived.

TTY, SIGPIPE, interactive interpreter sessions, network drivers, database
services, compressed input operations and comprehensive table operations remain
unmeasured. UTC fixes the timezone, not wall-clock time: Agate DateTime captures
the current date (`agate/data_types/date_time.py:32–35`), so relative-date
fixtures require an explicit clock. Interpreter build recipes and transient
build inputs remain unknown. Any future product implementation must inject
filesystem, network, database and interactive capabilities and preserve both
CLI and SDK behavior without a subprocess or Python fallback.
