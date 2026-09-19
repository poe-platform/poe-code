# Architecture provenance and unknowns

Research performed September 17, 2026. This supplements existing source audits;
it does not rerun their oracles or certify their historical test results. The
architecture and SDK contract contain deliberate design requirements as well as
observed facts. Proposed export names are design decisions, not source APIs.

## Authenticated upstream inputs

The csvkit archive was downloaded anew from the URL in reference-profile.json.
Its SHA-256 was
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
All 209 existing source-manifest.json file hashes were recomputed directly from
archive members and matched. No archive extraction into product paths occurred.
Inspected primary paths included csvkit/utilities/csvpy.py and
csvkit/utilities/csvsql.py. csvpy explicitly rejects stdin, prioritizes dict over
agate, creates an actual reader/table object, tries the legacy IPython import
and falls back to code.interact on ImportError. csvsql creates memory SQLite for
query-without-URL, connects before reading tables and begins one transaction for
table operations and final queries. These are source findings, not JS behavior.

The agate_excel-0.4.2.tar.gz archive was downloaded from its frozen profile URL;
SHA-256 matched
`eed1dc6239f0e96720d962dc1bdfb4496e19687332c827fd8b1e587a917ea202`.
Inspected agateexcel/table_xlsx.py calls openpyxl.load_workbook with
data_only=True and the read_only setting, selects the active sheet by default,
uses cell values plus date/format metadata and handles dimension resetting.
agateexcel/table_xls.py calls xlrd.open_workbook with file bytes/on_demand,
selects sheet zero by default, determines types by column, converts dates using
book.datemode and releases resources. XLSX and XLS are therefore distinct
semantic adapters. Formula-cache/date/error/malformed-file completeness still
requires reader-source and corpus qualification; this inspection does not
establish an implemented decoder.

The frozen baseline record binds CPython 3.14.2, Agate 1.14.2, agate-excel 0.4.2,
agate-dbf 0.2.4, agate-sql 0.7.3, SQLAlchemy 2.0.54, Babel 2.18.0/CLDR 47,
openpyxl 3.1.5, xlrd 2.0.2, dbfread 2.0.7 and reference SQLite 3.50.4.
Locale is C, timezone UTC, stdio UTF-8/non-TTY, terminal 80 by 24. Optional
IPython/network-driver modules are absent in that profile. These details were
read from the existing profile, not independently reinstalled in this turn.
The CPython 3.9.6 record remains a separate unsupported diagnostic profile.
The inspected reference-profile.json SHA-256 was
`91d0bf90fa1727be3bedfd8914df32bd9d769215830f611311ee70674f1d664f`.

## Repository observations

Root and safe-bash AGENTS.md were read. No scoped AGENTS.md was found in the
csvkit, office-package or safe-python directories in the initial file inventory.
Existing untracked source/docs and staging were preserved. Public API inspection
used source plus package export declarations; no dist consumer qualification
was performed. These source hashes bind the reuse findings to this checkout:

| Input | SHA-256 |
| --- | --- |
| safe-bash/src/commands/xan/csv.ts | 2dda24db47c5e31950f3a1f03fe6f4026c7c94711c921782ea8071eac488d43d |
| safe-bash/src/commands/xan/selector.ts | 27d93b7f759b512b1710eaa9f532aeccf5a43fbd62e32d6010d6009d3e0c56af |
| safe-bash/src/commands/xan/writer.ts | 610a3dd7fbc97fda2d429221774b56da92d7937db75567e4327b7a93d5303c03 |
| safe-bash/src/commands/regex-execution/protocol.ts | f38aed73d9485f75c76dd84086f40b3cf2b55721334bfcea5624cc7d5dcc03d9 |
| office-package/src/index.ts | 2f5fa9e2344ba1d24789e1e9dbca5fb7e6d98863a9257848d631af0bd9718ca5 |
| office-package/src/zip.ts | 7cc9628afc2474ffe5cc7aaffbe610f89e2da7a3a1bc0ec35f16a33753e51a71 |
| office-package/src/compression.ts | 7f837134293b789f889c31f9bbf2b89d22d0219e4d90053730f0e62318425256 |
| safe-python/src/session.ts | c5118ee7c2d71fe00a4b350ca1d5c34b335d9cb48ca20f6520f2d42f0466c9c1 |
| csvkit/src/index.ts | a2196ad558f1e3c78c6e41c9a1806f494ac5db545ee315fddac38bdc9af48845 |
| csvkit/src/contracts.ts | c8234977bab39ea6074eb8de390dc1eb68715d7a4385c5c732fde481b50de93c |

Xan Scanner works on single-byte delimiters, strips initial UTF-8 BOM, skips
blank records and changes malformed-quote/CR handling by dialect. Selector
supports zero/negative indices, occurrence selectors and prefix/suffix patterns.
Writer serializes byte cells with LF endings and its own raw/BOM/CR decisions.
None was changed or selected as a compatible CPython/Agate implementation.
Existing sealed tests were untouched.

Regex descriptors cover grep/rg/glob with byte rows and independent ERE/BRE/expr
profiles, not Python re. Only bounded execution/lifetime patterns are candidates
for reuse; the syntax/Unicode/search semantics remain unqualified.

office-package publicly exports createZipCodec and createCompressionCodec.
The ZIP factory exposes readZipArchive/decodeZipEntry/makeZipEntry/writeZipArchive;
its profile/limits require explicit selection and testing for XLSX. Compression
modes are gzip/gunzip/inflate-raw/deflate-raw. The package declares pako 3.0.1;
reuse therefore has a runtime dependency closure even if safe-bash's own runtime
dependencies stay empty. No bzip2/xz/zstandard or workbook parser is exposed.

packages/ssconvert was absent; its docs/plans document proposes an implementation.
There is no current workbook SDK to depend on. PythonSession exports synchronous
exec/eval, session namespaces and opaque guest handles; its options supply
limits/signal/hash seed/input/output/warnings. Internal codec-module imports do
not provide a public arbitrary-library or Agate object injection API.

## Explicit engine observation

A reference-only Node v22.22.2 process imported node:sqlite and created
DatabaseSync(':memory:'). sqlite_version() returned 3.51.2. It created a table,
began a transaction, inserted one integer, rolled back and observed count zero,
then closed the connection. The runtime emitted its experimental SQLite warning.
This supports the selected injected memory binding and real rollback, not full
query/locking/driver/transaction/cancellation qualification. No persistent
filename, VFS, network database or SQL emulation was exercised.

Remaining unknowns include full Decimal/encoding/date/regex equivalence,
workbook/DBF reader corpus compatibility, SQLite revision differences and VFS
persistence, network-driver semantics, guest/library/REPL behavior and safe-bash
execution/consumer integration. Dependencies beyond the inspected exports have
not been selected or installed. Existing parser tests were not rerun because no
code changed; no operation or visual CLI behavior changed in this delivery.

Owned scratch archives lived only in out/csvkit-contract-research-20260917.
Their provenance and findings were reduced here before removing those archives.
Historical evidence and other owners' out material were preserved.
