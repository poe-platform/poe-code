# Independent text import stress review

Review date: 2026-09-20. A separate agent reviewed and repaired the implemented
`packages/ssconvert/src/codecs/text.ts`; the root agent retained package exports,
Safe Bash integration and Git ownership. No README files were edited.

## Reference and execution boundary

The review used the acquired Gnumeric 1.12.61 `src/stf.c`, `src/stf-parse.c`,
`src/sheet.c`, `src/gnumeric.h`, and GOffice 0.10.61
`goffice/utils/go-glib-extras.c`, all under `out/ssconvert-lifecycle`.
The archive SHA-256 and complete dependency/plugin/locale profile are recorded
in the root task evidence; this review did not independently authenticate the
archive again.

Native differential invocations used only the separate QA container
`ssconvert-statistics-qa`, with executable
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`,
`LD_LIBRARY_PATH=/out/ssconvert-statistics-oracle/prefix/lib`,
`GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`
and `GSETTINGS_BACKEND=memory`. Fixtures were original strings/byte sequences,
created only beneath the container's `/out`. Native was never imported, spawned
or used as a fallback by product code or unit tests.

## Regressions and validated repairs

- Nonprinting Unicode format/unassigned characters were accepted by the content
  probe. The probe now matches the GLib category rule, while retaining printable
  private-use and supplementary characters.
- An initial UTF-8 BOM leaked into the first imported string. It is decoded
  without changing the field; an interior BOM is preserved as native requires.
- CSV separator detection treated Unicode letters as punctuation and dropped
  fields in `"a",é` / `"b",ñ`. Punctuation/symbol categories and complete Unicode
  characters now govern detection and separator consumption.
- Advancing after a quoted field split a supplementary character. Native
  `"a"😀|x` imports both `a` and `x`; the repaired implementation does too.
- BOM-less XML UTF-16 prefixes were decoded as NUL-containing ASCII.
  Little/big-endian XML prefixes now select UTF-16 correctly.
- Incomplete final UTF-8/UTF-16 characters caused a Latin-1 fallback instead of
  native truncation. Decoding now retains the consumed prefix.
- Sparse rows wider than 256 columns failed the actual SDK engine with
  `Invalid cell address`. Import now expands sheet dimensions by native powers
  of two. Native's product-area check is disabled by `#if 0` in `sheet.c`.
- The 16385th CSV field was retained instead of dropped. The importer now caps
  native dimensions and emits exceeded/dropped warning message bodies in order.
- General text import used JavaScript whitespace trimming, which removed an
  interior trailing BOM that GLib preserves. Trimming now follows GLib space
  categories.
- Forced Windows-1252 accepted undefined bytes that native iconv rejects.
  Mixed bytes `80 81` now trigger native Latin-1 fallback instead of retaining
  a euro followed by a control.
- Explicit UTF-32LE/BE and UTF-7 overrides were unsupported. Bounded converters
  now cover measured byte ordering, incomplete UTF-32 units, UTF-7 shifted
  strings, implicit termination, escaped plus, supplementary characters and
  malformed-padding fallback. Generic UCS-4 uses native big-endian ordering;
  generic UTF-32 uses the captured native little-endian convention unless a
  big-endian BOM supplies the ordering.
- General separator candidates were fixed to C locale. Their argument/column
  ordering and tab comparison now use the source-defined decimal-locale rule.
  The German regression is source-derived, not a native German measurement.

Byte admission remains before decoding. Latin-1 conversion uses bounded chunks
instead of one array entry per byte. NUL replacement preserves warning ordering;
cancellation is observed after awaited diagnostics before further parsing.

## Verified coverage

`text-independent.test.ts` contains 26 passing tests, last run with
`npx vitest run packages/ssconvert/src/codecs/text-independent.test.ts`.
The test body total was approximately 20 ms. Fixtures are in memory; tests that
exercise file reads/writes use `memfs`. The actual `createEngine` is exercised
for BOM import and expanded sparse-sheet dimensions.

Coverage includes trailing empty fields/rows, sparse coordinates, content
probing limited to 512 bytes, native first-NUL probe stopping, binary C0/C1
rejection, invalid UTF-8 fallback, literal Latin-1 rather than Windows-1252,
invalid override fallback, input-byte admission, exact cancellation-reason
identity, NUL warning bodies and cancellation after warning delivery.

Native measurements returned status 0 for the successful Unicode separator,
private-use, UTF-16, incomplete encoding, overflow-column, UTF-7, explicit
UTF-32 and forced iconv-fallback fixtures. The Unicode U+200B content probe
fixture returned status 1 with `E Unsupported file format for file
"independent-stress.csv"`. Unit tests contain no native invocations, filesystem
writes outside memfs, LLM calls or screenshot tests.

## Remaining limits and QA procedure

The measured native GLib warning framing contains process IDs and timestamps.
This review verifies ordered warning message bodies; byte-identical native
framing is a remaining CLI diagnostic mismatch documented by the root owner.

The following are unmeasured and are not passes: exhaustive native iconv charset
and alias coverage; all XML/UCS-4/EBCDIC detection signatures; every malformed
UTF-7/UTF-32 sequence; Unicode-version differences between Node and the captured
GLib; native non-C locale behavior; and the 16,777,216-row overflow boundary.
The row limit comes from `GNM_MAX_ROWS=0x1000000`; a full-boundary unit fixture
was intentionally not added because it would violate fast-unit-test guidance.
The 16,384-column boundary is measured and covered by a sparse original fixture.

For additional QA, use the captured oracle environment, explicitly select
`-I Gnumeric_stf:stf_csvtab` when testing forced encodings of binary-looking
content, and export with `-T Gnumeric_stf:stf_csv`. Compare exit status, warning
ordering, output bytes, and namespace effects against the actual SDK/virtual
command. Keep new source/fixtures/output beneath `/out`, record unavailable
profiles separately, and delete temporary fixtures after the result is recorded.
Root-owned maintained workspace build/lint/unit and Safe Bash integration
results belong to the root task evidence and are not certified by this scoped
independent run.
