# csvcut behavior increment

The behavior task now exports `cutCsv(source, selection, runOptions)` from the
private command owner and the existing safe-bash `commands/csvcut` facade.
The separate command and safety tasks remain open. There is no CLI registration
or CLI/SDK parity claim in this increment.

Compatibility selection is csvkit 2.2.0 / agate 1.14.2, with the existing
`csvkit-2.2.0-ascii-v1` selector candidate and a default
`utf8-sig-permissive-v1` reader candidate. Source-main additions are not admitted.
The record engine retains its existing strict default. These profiles do not
claim complete Python 3.9 behavior. No XAN sources were imported.

## Reviewed increments

1. Independent literal projection tests failed because the behavior API was
   absent. Implementation uses the accepted shared parser, selectors, generated
   headers and serializer, without copying them or enforcing uniform widths.
2. H05 independently failed with `Skip lines must be nonnegative`. The behavior
   adapter now normalizes negative safe-integer physical skip counts to zero,
   matching the supplied release constraint without changing the engine contract.
3. An input-accounting control failed with `Missing expected rejection` for names
   input `a\nx` and `inputBytes: 2`. Full delivered chunk length is now admitted
   before parsing; the undecoded suffix is charged when names stops at the header.
   Names still never parses the suffix or advances to another producer record.

Review checked selector ordering and duplicate handling, projection before row
deletion, zero-column/one-empty-cell distinctions, EOF versus blank records,
headerless first-record replay, byte ownership, cancellation and cleanup ordering.
Ordinary mode buffers bounded records and prepared output before yielding. Parser,
selector and admission failures therefore precede ordinary output. Explicit BOM
output may precede failure. Downstream transport failures can produce partial
output and are the wiring task's responsibility.

## Acceptance cells

Statuses below describe behavior-unit evidence, not full CLI/native compatibility.
The original acceptance matrix remains authoritative and incomplete cells stay
open. All flag grammar cells G01–G06 and CLI/native exact diagnostics remain open.

| Cells | Evidence / remaining work |
| --- | --- |
| S01–S12, S14–S15 | Literal successful byte-output controls pass through equivalent typed selection options. |
| S13, S16–S20 | Failure and pre-output rejection pass; native diagnostic spelling and status remain open. |
| C01–C05 | Literal outputs pass, including the release open-end exclusion defect. |
| C06–C07 | Rejection before output passes; native diagnostics remain open. |
| R01–R05 | Ragged padding/discard, deletion after projection, textual spaces/zero and serialization pass. |
| N01–N03, N05, N07 | Names formatting, bypassing selectors, ordinary EOF and blank-header controls pass. |
| N04, N06 | Structured failures and no output pass; CLI diagnostics/status remain open. |
| H01–H05 | Headerless replay/generated names and physical-line skipping, including negative counts, pass. |
| D01–D04, D07, D10 | Qualified dialect, multiline, BOM/CRLF, space and quoting-NONE controls pass. |
| D05–D06, D08–D09 | Other encodings and NONNUMERIC remain open engine/profile prerequisites; no inferred conversion was introduced. |
| O01–O02 | Emitted-record numbering after deletion and explicit BOM output pass. |
| G07–G08 | ASCII selector subset and malformed/huge ranges have controls; Python Unicode integer grammar and exact CLI errors remain open. |
| P01 | One permissive junk-after-quote control and explicit strict rejection pass; complete Python recovery remains open. |
| P02–P05 | Existing engine supports only its documented candidate subset; complete versioned quoting/NUL/codec/field-size profiles remain open. |
| P06 | Direct preserved embedded CR/CRLF writer behavior passes; native text-opening translation remains open. |
| P07–P08 | Basic skip, names stopping before malformed suffix, embedded names and 999/1000 display controls pass; all required native boundary captures remain open. |
| P09 | csvcut numbering of multiline records passes; grep's independent physical-line controls are outside this increment. |
| P10–P12 | Standalone sniffer, CLI help/errors, compressed-input admission and their native controls remain open. csvcut does not sniff. |
| B01 | Every split of a BOM/UTF-8/CRLF/quoted-multiline fixture, empty chunks and reused storage pass; all original fixture combinations remain open. |
| B02–B03 | Pre-abort, pending cooperative reads, falsey reasons, cancellation between records, cleanup-before-acquisition, admission closure and once-only retirement pass. Sink/VFS ownership controls remain open. |
| B04 | Quota failures cover input, decoded, retained, output, work, field, cells, projection and arguments; exact input/decoded/output and output one-over controls pass. Full boundary/rollback matrix remains open. |
| B05 | Reused producer storage and independent owned output pass. Canonical packed CSV error identity is checked; full realm qualification remains open. |
| B06 | Shell/VFS pipelines, redirects, literal path and alias controls remain open for wiring/safety. |
| B07 | Ordinary malformed/selector rejection precedes output; explicit BOM-before-failure passes. Sink-failure behavior remains open. |
| B08 | New runtime source imports only the admitted first-party CSV engine and a type-only local source capability. No host/network/files/native/download capability is acquired. Full denied-capability integration controls remain open. |
| B09 | Checkpoint/replay and advertised-realm qualification remain open. |
| B10 | Packed runtime and strict declaration consumer qualification is recorded below. |
| B11 | CLI screenshots remain open; this increment adds no CLI surface. |

## Accounting and lifetime

Input counts delivered byte-view length, including a names-mode suffix deliberately
left undecoded. Ordinary parser chunks are at most 4096 bytes; names-mode parser
chunks are one byte to avoid reading beyond the header. Empty producer chunks
still consume work. Decoded accounting uses UTF-16 storage bytes. Retention
conservatively accounts parser intermediates, retained records, selection and
projection arrays, formatting strings and encoded output without credit reuse.
This is a conservative allocation ledger, not a JavaScript heap/RSS measurement.

Exact UTF-8 output size is admitted before allocating output bytes. Arguments
reserve three bytes per UTF-16 code unit; this is a conservative bound rather than
an exact encoded-length receipt. Parser, selector and writer work use the shared
ledger; projection, iteration, formatting and encoding add their own charges.
Ranges validate endpoints against header width before expansion. All algorithms
are iterative: there is no recursion allowance or recursive execution.

Options and limits are captured before the first asynchronous boundary. Cleanup
is synchronously registered before acquiring a producer, closes admission,
cancels the invocation child signal and drains cooperative iteration. Producer
retirement is idempotent; primary producer failure identity follows the existing
engine policy, and a retirement-only failure is reported. `finally` disposes
parser and budget and removes the parent abort listener. Consumers must close
early iteration and await downstream writes; arbitrary injected host work is not
sandboxed or forcibly preempted. Storage retained by consumers after emission is
outside this invocation and needs its own accounting.

## Verification receipt

- `npm test --workspace=safe-bash-command-csvcut`: 69 passing tests, no skips or
  failures; all fixtures and capabilities are memory-backed, with no native oracle.
- `npm run lint --workspace=safe-bash-command-csvcut`: maintained ESLint and both
  source/test typechecks.
- `npm run build:workspaces -- --workspace=safe-bash-command-csvcut` and
  `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: maintained
  selected build closures passed, including the guarded safe-bash compiler.
- Packaging and installed-consumer verification use the maintained
  `scripts/package-safe.mjs` route, public tarballs only, and an external temporary
  consumer with scripts disabled and offline installation. No private workspace
  is installed. The existing private-command fixture adds literal projection and
  delivered-names-input quota controls; the strict NodeNext csvcut consumer adds
  the behavior options and owned-byte generator types.
- Final candidate `0.0.0-behavior-csvcut-final`: public tarball installation,
  `safe-packages-private-command.mjs`, strict NodeNext compilation of
  `safe-packages-csvcut-types.mts`, and explicit absence checks for both private
  command/engine workspaces passed. The maintained packer admitted and rewrote
  runtime and declaration dependencies into the public artifact. This qualifies
  the local Node candidate, not publication or other runtime realms.

Temporary staging uses the repository's ignored `out` directory because absolute
`/out` is unavailable on this host. Task-owned staging and the external consumer
are purged after the final installed checks. No standalone private package is
published. Local commits: none. Remote-main delivery: none. Releases: none.

## Follow-up admission review

Reviewed the current behavior implementation against its literal selector,
projection, serialization and lifetime controls. Two independently reproduced
failure-path findings were repaired with failing tests first: non-byte producer
chunks leaked intrinsic `TypeError`s, and detached storage was silently accepted
as an empty chunk. Admission now obtains the actual typed-array extent and creates
a borrowed byte view using intrinsic buffer/offset getters. View construction
rejects detached storage even at length zero; invalid storage reports canonical
`CsvError` with code `INPUT`. The fixed-size view is charged 32 retained bytes
before construction. No producer bytes are copied or retained beyond consumption.
Budget failures remain outside the conversion-error catch and retain code `LIMIT`.

Added memory-only controls for invalid chunks with once-only retirement and no
ordinary output, invalid/truncated UTF-8 in discarded excess cells, empty-chunk
work exhaustion, sliced views with hostile producer property getters, and exact
Unicode/BOM output-byte boundaries. These strengthen B01, B04, B05 and B07; they
do not close the original incomplete acceptance cells or qualify Python recovery,
codecs, quoting, CLI grammar, screenshots, checkpoint/replay or additional realms.

No new abstraction, proxy function, external dependency, host capability or
recursive algorithm was introduced. Existing selection and serialization remain
owned by the admitted first-party engine; safe-bash remains an export facade.
The reviewed repairs have no unresolved finding. Full compatibility and CLI/SDK
qualification remain blocked by the open cells above and require their separate
planned increments.

Fresh follow-up checks passed: 74 csvcut workspace tests, maintained workspace
lint with source/test typechecks, and the maintained selected safe-bash build
closure. The maintained packer produced candidate
`0.0.0-csvcut-admission-review`; an external consumer installed only public
tarballs offline with scripts disabled. The existing private-command runtime
fixture and strict NodeNext csvcut declaration fixture passed. Additional
installed controls verified canonical structured errors, no output and once-only
retirement for all malformed/detached chunk fixtures. Private csvcut, CSV-engine
and contracts workspaces were absent. This is local Node artifact evidence;
no publication, remote-main delivery or release is claimed. Task-owned staging
and consumer files were purged after verification. Local commits: none.
