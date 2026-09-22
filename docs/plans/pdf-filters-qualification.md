# PDF filters: draft qualification

Status: implemented working-tree increment, draft qualification. This task owns
stream filter decoding only. Byte syntax, xref/revision recovery, encrypted
objects, pages, fonts, text ordering and lossless rewriting retain independent
qualification. Filtered xref/object-stream bootstrap and indexing remain deferred
integration gates: this increment does not remove their explicit unsupported
checks or change stream boundary recovery.

## Ownership and byte contract

Private `packages/pdf-parser` owns `src/filters.ts`, `src/flate.ts` and
`src/filter-buffer.ts`. `src/syntax.ts` owns cumulative work, retained-allocation
and expanded-byte counters, including delegation from child readers. The new
standalone `decodePdfStream` accepts only supplied bytes and a parsed dictionary;
optional reference lookup is an explicit synchronous object capability.
`PdfDocument.decodeStream` uses its own index and the same document budget.
No file, URL, subprocess, native library, WASM or ambient font capability exists.

Results retain raw stream bytes independently of caller input mutation, expose
stage output bytes and a remaining filter suffix for explicitly requested image
preservation. No lexical string conversion, XML sanitation, Unicode normalization
or automatic decrypting is performed. An image-preserved result is encoded, not
successfully rendered/decoded content. Required image decoding and unknown filters
fail `UNSUPPORTED`. Corruption fails `SYNTAX`; work/allocation/expansion exhaustion
fails `LIMIT`. Cancellation reasons and lookup failures propagate unchanged.
Recovered document decoding is rejected because the scan lacks a qualified
revision security context; raw object/stream inspection remains available.
No quota or cancellation recovery path exists in these APIs.

Every stage uses one budget; predictors also count their output. The retained
admission model conservatively accounts staging slots, final copies, LZW's fixed
4096-entry prefix/suffix tables and stack, Huffman Maps/arrays, predictor rows, and bounded reference-chain visited keys.
It is cumulative allocation admission, not exact engine heap measurement or a
live-byte reclamation model. Default expanded limit is 32 MiB, but retained/work
limits can stop earlier. Input snapshots also have the existing independent
input-size admission. Bit reads, dictionary walks, copies, emitted bytes and
predictor sample operations charge work and check cancellation synchronously.
This synchronous API does not yield the event loop or invent a wall-clock timeout.

## Implemented cells and evidence

| Feature | Current original in-memory controls | Qualification |
| --- | --- | --- |
| ASCIIHex | whitespace, odd nibble, byte preservation, invalid digit, missing marker, chains | Strict marker-required increment |
| ASCII85 | full tuples, zero shorthand, final partial tuple, overflow, malformed shorthand/marker | Strict increment |
| RunLength | literal/repeat/end code, truncation, expansion denial | Strict increment |
| Flate | zlib header/checksum, stored/fixed/dynamic blocks, code-length repeats, empty distance tree, overlapping backrefs, invalid distance, expansion denial | Initial strict RFC 1950/1951 increment |
| LZW | clear/reset, EOD, KwKwK, invalid codes, EarlyChange 0/1 at 9/10/11/12-bit transitions | Initial strict increment |
| TIFF predictor | packed 1/2/4-bit and 8/16-bit samples, multiple colors, LZW/Flate paths, checked row size | Initial 1/2/4/8/16-bit increment; wider corpus pending |
| PNG predictors | None/Sub/Up/Average/Paeth, first-row zeros, truncated rows, invalid tags | Initial row-based increment |
| Parameters | aliases, chain order, refs/nulls, mismatched arrays, malformed numbers, cycles | Initial dictionary increment |
| Identity Crypt | missing/default Name, explicit Identity, non-Identity unsupported | No encryption qualification |
| Shared quotas | cumulative chain output and repeated document decoding, work/retained denial | Fatal admission controls |
| Cancellation | initial abort, lookup abort, mocked mid-decode abort for every codec | Unchanged reasons |
| Raw streams | document reads before/after decoding, preserved image suffix after ASCII decoding, caller input mutation | Byte-preserving increment |

`src/filters.test.ts` uses original fixtures and independent bit/code packers,
not compressor/native oracle processes. It creates no files and queries no LLM.
Existing syntax/revision tests remain included. No acceptance claim for upstream
recovery parity, all DEFLATE combinations, all LZW dictionary saturation cases,
all producer PDFs, image rendering, or full PDF 1.0–2.0 follows from these cells.
ASCII filters require their explicit terminator; the increment does not skip
non-hex garbage or silently accept missing ASCII markers. Codec terminators end
the corresponding encoded stream; raw trailing bytes stay preserved in `raw`.

## Independent image decoding gates

| Filter | Current inspection behavior | Required before decoding qualification |
| --- | --- | --- |
| DCTDecode / DCT | Preserve JPEG codestream after earlier stages | Bounded JPEG markers/tables, baseline/progressive entropy, sampling, color transforms and truncated/adversarial scans |
| JPXDecode | Preserve JPEG 2000 codestream/container bytes | Tile/component/precision limits, boxes, progression orders, wavelets, entropy, color/alpha and allocation/work limits |
| JBIG2Decode | Preserve page bytes; parameters remain in source dictionary | Supplied/bounded JBIG2Globals resolution, segment graph and cycles, symbol dictionary limits, arithmetic/MMR decode and bitmap budgets |
| CCITTFaxDecode / CCF | Preserve encoded fax rows and source parameters | Columns/Rows/K/EndOfLine/EncodedByteAlign/EndOfBlock/BlackIs1 semantics, Group 3/4 tables, malformed rows and bitmap budgets |

Each future decoder must start with failing independent in-memory tests and share
all invocation quotas/cancellation. No text-only workflow may interpret preserved
image bytes as content operators. No existing PDF renderer is imported.

## Reference and license boundary

Research reference revisions supplied for this task remain pinned:

- PDF.js `579c4b700f23f7782234f03358b5e9eaa3f58889`, Apache-2.0.
- pdf-lib `93dd36e85aa659a3bca09867d2d8fac172501fbe`, MIT.
- qpdf `54d6053af283bbeb8b325f4886c0f65cc51f2b80`.
- MuPDF `89c1d183a7fb724898b2017d6ecd402a61886d4f`, AGPL/commercial.
- Poppler `0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46`, GPL.

Implementation and fixture authoring are original first-party source. No code,
licensed assets or implementation tables were adapted/copied from those parser
repositories; RFC algorithm tables implement the standard. Existing MIT package
license remains intact. No external parser adoption is proposed or authorized.
Inspection found `packages/office-package/src/compression.ts` uses external
`pako` internals; importing it would violate this engine's runtime dependency
boundary. Existing `packages/pdf` is not reused. No verified dependency-free
first-party codec closure was established for reuse in this increment.

## Integration and verification boundary

The requested command package convention currently exists at
`docs/plans/archive/safe-bash-command-package-pattern.md` (the original path is
already moved in the working tree). Its contracts → engine/command → Safe Bash
boundary, explicit opt-in exports, canonical realm identity and installed packed
consumers remain required. This task adds no command export, command dependency
or command behavior. The engine is a private zero-dependency workspace; consumers
must bundle its required first-party implementation and declarations through the
maintained builder/packer, never import an ambient unpublished package. Unused
engine source is not added to command artifacts merely to claim integration.
Actual Safe Bash consumer packaging remains an independent dependent task gate.

An in-memory esbuild browser IIFE of the public parser entry had exactly six
first-party inputs (syntax, filter-buffer, flate, filters, revisions, index), zero
external imports and decoded an ASCIIHex fixture in an isolated Node VM without
process, Buffer, require or fetch. This proves a self-contained candidate graph;
it is not a shipped Safe Bash tarball, browser/workerd runtime qualification,
complete host-isolation audit or replay qualification. No artifacts/log files
were created by that check.

Verification commands and final receipts follow.
No CLI visual behavior changes; screenshots are not applicable. No new runtime
package, shared configuration or workspace boundary was modified. Local commits,
remote-main delivery and release publication are separate and unperformed.

## Final local verification receipt

- `npm run test:unit --workspace=pdf-parser`: 47 tests passed, zero failures or
  skips, including the 24 existing syntax/revision controls. New API tests were
  observed failing before implementation; reference bookkeeping and missing
  revision security-context checks were also reproduced before fixing them.
- `npm run lint --workspace=pdf-parser`: ESLint and source/test typechecks passed.
- `npm run build:workspaces -- --workspace=pdf-parser --no-cache`: the maintained
  explicit workspace build closure passed, including the dist guard and license
  copy. No broad repository gate is claimed for this package-local increment.
- In-memory bundle/isolated realm check: zero external imports; six first-party
  source inputs; ASCIIHex output verified without ambient host APIs. Actual
  shipped Safe Bash integration and advertised-runtime qualification are pending.

No local commit, remote-main push or release was performed. This receipt does
not mark independent parser/command/image/encryption qualification gates complete.

## Task diff review receipt, 2026-09-21

Review reproduced three findings with failing original in-memory controls before
changing implementation:

- Dynamic DEFLATE headers incorrectly rejected HDIST counts 31/32. RFC 1951
  permits up to 32 distance entries; reserved symbols 30/31 still fail if used.
  Original dynamic fixtures now cover counts 1/30/31/32.
- Document decoding checked recovery/encryption gates before cancellation.
  An aborted document now propagates its exact reason before those gates.
- Standalone decoding checked retained admission after copying its input.
  Snapshot admission now occurs in the reader before allocation/copying, with
  redundant standalone/fork reservations removed. Document snapshots also count
  toward cumulative retained admission; low retained limits can reject earlier.
  An instrumented in-memory control proves denied snapshots are never copied.

No proxy-only function or unsafe host capability was found in the reviewed filter
closure. Existing codec helpers own distinct decoding, bit reading or budgeted
output responsibilities. No unrelated contributor changes were reverted.
No snapshot format, package version, external runtime dependency or CLI surface
changed. No unresolved finding remains within this filter review; the independent
qualification gates listed above remain pending.

After the final code changes, all 47 package unit tests passed with no skips,
package lint/source-and-test typechecks passed, and the maintained explicit
workspace build passed with `--no-cache`. The fresh in-memory browser bundle
contained six first-party inputs and zero external imports, and decoded ASCIIHex
in an isolated VM without supplied host capabilities. These checks do not qualify
shipped command integration or actual browser/workerd runtimes.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No logs or generated evidence files were retained.

## Independent trailing-data and saturation review, 2026-09-21

The candidate already present in the working tree was inspected without replacing
other contributor changes. A new original in-memory test first failed with
`SYNTAX: trailing deflate data`: Flate assumed the enclosing raw stream ended
exactly at the zlib checksum, contrary to the terminated-codec byte contract.
Checksum location now derives from consumed final-block bytes. Stored, fixed and
dynamic controls accept trailing binary data and a second zlib member while
decoding only the first member; corrupted and truncated checksums still fail.
Raw bytes remain exact. Additional LZW controls retain twelve-bit widths after
dictionary saturation, fetch entry 4095, clear/reset, reject truncation and deny
expanded quota exhaustion for both EarlyChange settings. Fixture transition
positions and last-entry output are explicit and independently specified.

Executed candidate QA is described in `pdf-filters-candidate-qa.md`:

- Package unit route: 49 passed, zero failures, cancellations or skips. The
  deliberate initial failing regression was resolved before final verification.
- Package lint, source/test typechecks and fresh maintained workspace build with
  `--no-cache`: passed. Scope remains confined to this private engine and its
  documentation; no repository-wide test/lint/build gate was run or claimed.
- Built SDK: original empty zlib fixture, trailing raw preservation, checksum
  corruption negatives and ASCIIHex/Flate cumulative expansion: passed.
- In-memory browser IIFE: six first-party inputs, zero external imports; isolated
  Node VM chain order, byte ownership, shared expansion, falsey cancellation and
  image preservation: passed without supplied process/Buffer/require/fetch.
- Source/import boundary review and task-scoped whitespace check: passed.

Exact six-file source graph SHA-256:
`eabf17764f066c92447e5d025226b87ffbea1d97350dcf4b606694738aea4587`.
Hash construction uses sorted input paths; for each, append UTF-8 path, NUL,
file bytes, NUL to SHA-256. Inputs are `src/filter-buffer.ts`, `src/filters.ts`,
`src/flate.ts`, `src/index.ts`, `src/revisions.ts`, `src/syntax.ts`, each prefixed
by `packages/pdf-parser/`. This identifies the tested source candidate and is
not a commit, published artifact or upstream compatibility receipt.

CLI/screenshot and checkpoint/replay controls are inapplicable to this unchanged
standalone byte API. Actual browser/workerd cells, shipped Safe Bash command
integration, mapped upstream producer/recovery variants and image decoding remain
unverified independent gates. No native oracle or third-party parser was used.
No deterministic correctness check is reported as performance qualification.
Local commits: none. Remote-main delivery: none. Successful releases: none.
No task-generated files/logs were retained outside these qualification documents.
