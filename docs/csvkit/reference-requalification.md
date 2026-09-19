# csvkit 2.2.0 reference requalification, 2026-09-17

This is research against native reference installations, not product execution.
Existing documents and parser work were present before this pass and are
preserved. No product, README, staging, commit or release change belongs to this
pass. QA procedure: `docs/plans/csvkit-reference-requalification-qa.md`.

## Evidence and hash domains

`reference-profile.json` links the reduced requalification JSON and two runtime
requirements locks by SHA-256. The authenticated PyPI csvkit source SHA-256 is
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
The archive was freshly downloaded and verified before bounded extraction.
All 209 sorted path/hash records exactly reproduce `source-manifest.json`.

The requalification JSON retains full non-pyc installed manifests for every
distribution, including installer packages. Each digest is SHA-256 of UTF-8
JSON with sorted keys and compact separators over the sorted array of
`{path, sha256}` records. Paths are distribution-relative and include generated
scripts and metadata. A digest authenticates that installation's records, not
a universal wheel or source archive. The source/wheel artifact digests use raw
downloaded bytes and were checked against version-specific PyPI JSON metadata.
The two definitions must not be interchanged.

There are 48 freshly verified artifacts: 22 dependency source archives, 22
selected dependency wheels, and four installer/build-tool wheels. csvkit itself
was installed from its authenticated source archive. Build-isolated csvkit WHEEL
metadata records setuptools 82.0.1 (3.9.6) and 84.0.0 (3.14.2). The full
transient build inventories and original interpreter build recipes were not
captured; no reproducible-build attestation is implied.

## Actual dependency reconciliation

Both fresh installs retain Agate 1.14.2, agate-excel 0.4.2, agate-dbf 0.2.4 and
agate-sql 0.7.3. The original version closures exactly match after excluding
installer pip/setuptools. The requirements locks include all active runtime
distributions and authenticated source/selected-wheel hashes. Distribution
metadata preserves all requirement strings and their markers/extras; inactive
test extras are not installed or counted in the active closure.

Both hash-pinned locks were additionally resolved with pip 25.3 using dry-run
and ignore-installed, without omitting dependencies. Both returned status 0 and
exactly matched their full active runtime closure. Selected artifact hashes are
retained under `runtimeLockReplay`; this checks replay selection and metadata,
not deterministic wheel construction or product behavior.

| Dependency | CPython 3.9.6 | CPython 3.14.2 |
| --- | --- | --- |
| csvkit | 2.2.0 | 2.2.0 |
| agate / agate-excel / agate-dbf / agate-sql | 1.14.2 / 0.4.2 / 0.2.4 / 0.7.3 | same |
| Babel / CLDR | 2.18.0 / 47 | same |
| parsedatetime / isodate / pytimeparse | 2.6 / 0.7.2 / 1.1.8 | same |
| openpyxl / et-xmlfile / xlrd / olefile | 3.1.5 / 2.0.0 / 2.0.2 / 0.47 | same |
| dbfread / leather / text-unidecode | 2.0.7 / 0.4.1 / 1.3 | same |
| SQLAlchemy / typing_extensions | 2.0.54 / 4.16.0 | same |
| python-slugify | 8.0.4 | 9.0.0 |
| importlib_metadata / zipp | 8.7.1 / 3.23.1 | absent |
| pip in this recheck | 25.3 | 25.3 |
| setuptools installed in runtime venv | 58.0.4 | absent |

The original 3.9.6 profile used pip 21.2.4. It remains preserved separately;
installer upgrade in this recheck did not change any of the 56 CLI captures.
SQLAlchemy's platform-specific greenlet requirement is inactive for these arm64
profiles; greenlet is absent. python-dateutil is also absent, not a hidden
dependency inferred from historical prose.

## Source provenance for reduced claims

Locations refer to freshly checksum-verified archives, not a floating repository.
`verifiedArtifacts` identifies their source URLs and SHA-256; csvkit file hashes
also appear in the independently reproduced source manifest. Dependency files
below were extracted as bounded regular text files and inspected.

| Claim | Pinned source or observation |
| --- | --- |
| Original fourteen executable names and launch targets | csvkit source `csvkit.egg-info/entry_points.txt`; both installed console_scripts entry-point maps; exact independent expected-name assertion |
| Runtime QUOTE_* choices | csvkit `csvkit/cli.py:29`; both actual `quoteConstants` maps; eight `quotingCommandObservations` |
| Environment-based input encoding; en_US typed locale | csvkit `csvkit/cli.py:207` and `:211`; exact capture environment |
| Stdin reconfiguration and compression extension dispatch | csvkit `csvkit/cli.py:273–294` |
| Conditional no-header warning suppression | csvkit `csvkit/cli.py:142–145` |
| Agate number locale symbols | Agate `agate/data_types/number.py:38–54` |
| parsedatetime date parser; explicit-format OS locale | Agate `agate/data_types/date.py:29–30` and `:72–84` |
| parsedatetime datetime and current-date source time; ISO fallback | Agate `agate/data_types/date_time.py:32–37` and `:112` |
| Duration parser | Agate `agate/data_types/time_delta.py:3` and `:33` |
| CLDR identity | Babel `CHANGES.rst:16` and installed `babel.core.get_cldr_version()` |
| parsedatetime warning filters | parsedatetime `parsedatetime/warns.py:25–26`; `warningsBeforeImports` / `warningsAfterImports` |
| Excel / DBF reader bindings | agate-excel `agateexcel/table_xlsx.py:9`, `table_xls.py:10`; agate-dbf `agatedbf/table.py:6` |
| SQLAlchemy binding | agate-sql `agatesql/table.py:11–18`; installed requirement metadata |
| Legacy optional IPython path | csvkit `csvkit/utilities/csvpy.py:74`; module absent in both reference installs |
| OS/locale/encoding/buffering/decimal/native versions | Actual isolated `runtime`, `locale`, `stdio`, decimal context and native-module inspection fields |

All 112 prior captures reproduced byte for byte after strict UTF-8 decoding:
14 names × four argv forms × two profiles. Every observation retains independent
stdout, stderr and status. Another 56 observations exercise invalid quoting and
invalid field-size values; some utilities suppress these common options, so
their errors are unrecognized-option errors rather than type/choice errors.
All have status 2. Eight quoting fixtures show status 0 for 4/5 on 3.14.2 and
status 2 on 3.9.6. The standard-library CSV mixed-row probe is distinct from
these command captures and is retained under `quotingRoundTrips`.

## Limits retained after reduction

Homebrew python3.14 resolved to 3.14.7 and was rejected. The replacement used the
installed pinned 3.14.2 interpreter, whose executable hash exactly matches the
original profile. CPython 3.9's stdlib metadata API rejected the inspection's
modern group keyword; using the actual installed importlib_metadata backport
resolved that research-helper incompatibility. Both attempts are reduced in
`rejectedAttempts`; neither is accepted runtime evidence.

macOS library install-name/current-version metadata is not the compression
library's release version. On 3.9.6, otool bindings identify the exact OS bzip2
and lzma libraries; their version functions report 1.0.8 and 5.4.3. On 3.14.2,
the builtin modules expose those functions through process symbols. Native
extension/interpreter/library hashes are retained where backed by actual files;
builtin modules have no separate file. The 3.9 sysconfig library path points to
an unavailable Xcode build location; the executable's relative otool binding
identifies the actual CommandLineTools framework, whose hash is retained.

No TTY, SIGPIPE, interactive Python/IPython, external driver/dialect, service,
full compression operation, workbook/DBF operation, inference or statistics
qualification is claimed. UTC is a timezone profile; the wall clock is not
frozen. OS shared-cache library byte manifests and transient build inventories
remain unknown. Sources, environments, captures and helpers in the owned out
directory are purged only after their facts, failures and limits are reduced.
