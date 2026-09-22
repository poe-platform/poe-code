# behavior-soffice: explicit UTF-16 CSV text increment

The intended behavior matrix remains incomplete. No acceptance cell is closed.

Extended the existing private first-party CSV text serializer with the explicit
product encoding `UTF16`. Both byte orders emit a mandatory BOM, encode UTF-16
code units without host codecs or dependencies, preserve surrogate pairs, and
use the existing quoting and line-ending policy. This does not admit a native
numeric charset ID or qualify LibreOffice charset-map compatibility.

TDD: exact-byte little/big-endian and output-budget tests first failed with
`unsupported`; the implementation then passed. The negative byte-order test
asserts failure before BOM output. All 41 package unit tests pass; package lint,
production/test typechecking and the selected fresh workspace build pass.

Input accounting continues to measure supplied text as UTF-8 equivalent bytes;
caller-owned decoded strings are not new decoded allocations. Output accounting
includes the two-byte BOM, two-byte LF, doubled quotes and surrogate pairs.
Existing conservative retained reservations cover fragments, joined text and
the allocated output row. Encoding work is prepaid before allocation; UTF-16
encoding checkpoints cancellation for each code unit. No recursion is added.
Failed rows release their own reservations and do not yield a partial row.
An earlier BOM or row can already have transferred to the consumer: publication
still requires invocation-owned VFS staging and discard.

Manual QA executed against the source API in memory:

1. Export `é🙂` plus an empty cell in each byte order. Inspect literal expected
   bytes, BOM, delimiter and LF; verify 12 output bytes and 6 input bytes.
2. Allow only five output bytes and export `a`. Observe the BOM, then a limit
   error with no row; verify retained bytes return to zero.
3. Supply an invalid byte order. Observe unsupported-profile failure with zero
   output bytes, including for an empty row iterable.
4. Run all package unit tests, lint/typechecks and the fresh selected build.

No CLI visuals change; screenshots are not applicable to this source-only API.
Installed artifact, CLI/SDK conversion, realm/replay, native conversion and
original-document screenshot qualification were not run. ODF/OOXML engines,
VFS batch conversion/publication, font shaping/pagination and PDF profiles remain
missing. No standards or layout compatibility claim follows from this increment.
The package remains private with no external runtime dependencies. No commit,
push, release or publication was performed. Unrelated edits were preserved.
