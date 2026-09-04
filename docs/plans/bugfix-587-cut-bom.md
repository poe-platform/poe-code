# #587 preserve BOM characters in cut character mode

## Scope and baseline

- September 4, 2026; baseline `58dc2afbd846b2dfb38ae45071872c25d7730d8c`.
- `gh issue view 587` confirms author `kamilio`, OPEN, and the M12 report.
- `text.ts` creates a default TextDecoder per cut character-mode record, so
  a leading UTF-8 BOM is consumed even on records after the first file line.
- Own only that cut decoder, new unsealed `tests/commands/cut-bom.test.ts`,
  and this plan. Root owns literal test registration, Git, gates and release.

## TDD and compatibility

1. RED: tiny exact-byte first/mid-file/repeated BOM fixtures, code-point selection,
   byte mode, NUL/LF/CRLF and unterminated-record framing, stdin/file/chunk inputs.
2. Set only the cut character decoder's ignoreBOM option, preserving replacement
   decoding, byte selection, character indexing, existing chunk size and checks.
3. GREEN: focused new and existing small cut semantics, deterministic cancellation,
   decoder-boundary compatibility and no-emit types. No resource probes or gates.
4. Audit the listed other decoder sites read-only; do not apply a blanket change.

## Read-only decoder audit

- `search/rg.ts` is now a wrapper. The default fatal decoder is in
  `search/rg-command.ts:26`, decoding each `-f` pattern file once, before splitting
  pattern lines. It consumes one initial BOM, not every searched record's BOM.
  `search/output.ts:9` explicitly preserves BOM in valid UTF-8 output data.
  The search README specifies UTF-8 pattern files but no explicit pattern-file
  BOM contract; preserve current signature normalization pending a separate root
  policy decision. No native ripgrep BOM parity or comprehensive search audit is
  claimed, and this is not the demonstrated cut record-corruption path.
- `yq/index.ts:389` deliberately uses fatal UTF-8 and ignoreBOM:false when decoding
  document frames. `yq/DESIGN.md:49` requires accepting a leading UTF-8 BOM.
  `tests/commands/yq-author-20260828/yq.test.ts:407` covers document-prefix BOMs
  while preserving a quoted interior U+FEFF. Stripping the encoding signature
  here is consistent with the YAML document contract; do not flip this decoder.
- `file/classify.ts:75` detects UTF-8/UTF-16 signatures before fatal decoding.
  The decoded text is used for control/JSON/text classification, not emitted as
  transformed source bytes. Its README documents BOM-aware encoding detection
  and fixtures include UTF-8 BOM text. Consuming the encoding signature supports
  that classifier role; no change or stronger native-classification claim.
- `html-to-markdown/input.ts:77` keeps one fatal streaming decoder per operand.
  Its README explicitly says an initial UTF-8 BOM is ignored per operand, and
  `render.test.ts` includes a leading-BOM fixture. This is intentional document
  input normalization, not repeated per-line stripping; leave unchanged.
- All four sites were audited read-only. No README or other production changes.

## Delivery

- No other production paths, README, registry, seals/captures or Git changes.
- Record exact RED/GREEN, audit findings, no-emit types and final SHA-256; freeze
  before root registration/commit/push/release work.

## Validation and frozen handoff

- Tiny-byte RED: 37 tests, 10 pass and 27 fail. The issue input
  `41 0a ef bb bf 42 0a` actually yielded `41 0a 42 0a`: the BOM disappeared but
  the final newline did not. This corrects the issue body's omitted final LF.
- Separate RED for the existing 4096-byte decoder boundary: a BOM followed by
  4092 ASCII characters puts an astral character across that boundary. Selection
  4094-4095 incorrectly yielded `éZ` instead of `🙂é`. This one fixed 4103-byte
  input is a chunk-boundary semantics control, not a resource/scaling probe.
- Product change is exactly one decoder constructor in `text.ts:553`:
  UTF-8 with ignoreBOM:true. Replacement decoding, byte/field modes, record
  delimiters, decoder chunk size and cancellation checkpoints are unchanged.
- GREEN: all 38 new tests pass. Coverage includes first/mid-file/repeated/interior
  BOMs, astral positions, invalid UTF-8 replacement, partial byte-mode BOM output,
  LF/CRLF/NUL/unterminated records, file/stdin/single-byte chunks, decoder-boundary
  streaming, and deterministic cancellation after decoding with input cleanup.
- Two selected maintained controls pass: `cut supports overlapping/open ranges,
  complement, literal fields and UTF-8 characters` and `cut preabort preserves
  false/null reasons without reading or writing`. Larger resource tests and
  the browser-building portable suite were not run.
- Focused strict no-emit TypeScript: owned `text.ts` and `cut-bom.test.ts` roots
  plus imports, existing package options, incremental:false; zero diagnostics.
  Owned diff whitespace check passes. No build/broad gate/native parity claim.
- Node 22.22.0 via `/tmp/kamilio-toolchain.path`; TMPDIR is
  `/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp`; TSX_DISABLE_CACHE=1;
  NO_COLOR unset; child Git-local variables cleared.
- Logs in `/home/kjopek/kamilio-validation-569-575.RoFXyZ/587-cut/`:
  `red.log`, `boundary-red.log`, `green.log`, `existing-small.log`, `types.log`.
- Root literal registry path: `packages/safe-bash/tests/commands/cut-bom.test.ts`.

### Initial handoff follow-up (resolved below)

- `packages/safe-bash/tests/commands/text.test.ts:333` explicitly expects the old
  BOM-stripping bug. Its input is `\uFEFFa\uFEFFb\n\uFEFFc\n`; the corrected
  output preserves that exact string, not `a\uFEFFb\nc\n`.
- A tiny direct execution confirms corrected input/output hex
  `efbbbf61efbbbf620aefbbbf630a`; the old assertion expects
  `61efbbbf620a630a`. This is a known stale compatibility assertion, not an
  unrelated failure or grounds to weaken production behavior.
- Scope expansion for that single expected-value correction was requested; the
  existing test is not edited without root approval. Its exact current hash
  `2ae7c863d0c219899480ab6a359d28c27d5fce1fb3f20c3883c9a7a5d9aa0a5a`
  appears only in the historical #567 plan. The maintained duration-weight entry
  references its path but does not seal its bytes. No live hash seal was found.
- The larger enclosing test also exercises 10001 ranges; it was not run under
  this no-resource-probe assignment. Root must update the stale expectation
  before broad gates; focused GREEN above is not a full-suite pass claim.

### Frozen SHA-256

| File | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/text.ts` | `d5696d6e42c9f171e63e392810756b22495af6a47bee3f32db345c0c4dd5b738` |
| `packages/safe-bash/tests/commands/cut-bom.test.ts` | `ae20f86dcdb9b8c9731dc0b66f9886a92fbc89afa5b692aa29fc37956133fcb9` |
| `packages/safe-bash/tests/commands/text.test.ts` (authorized correction below) | `d784bb1835e688d0059e6355b17fd2be06e8b824a3a7ac5b918e71519e094ffc` |

Owned implementation/tests frozen pending root handoff. No commits, pushes,
release actions, resource probes, registry, historical capture or seal edits.

## Authorized existing-assertion correction and final freeze

- Root explicitly authorized correcting only the existing BOM expected literal,
  retaining every other case, and running the complete text and cut-BOM files.
- Rechecked the pre-edit hash: its only tracked hash reference is the historical
  #567 plan. The maintained test-duration weight references the path, not its
  contents. No live seal was found; historical #567 evidence remains unchanged.
- RED: executing the original named chunk-boundary case against the reviewed
  decoder fix fails exactly at `text.test.ts:333`: actual retains all three BOMs,
  while the old expected literal drops the two record-leading BOMs. No unrelated
  failure is attributed to this correction.
- Changed only that expected literal to `"\uFEFFa\uFEFFb\n\uFEFFc\n"`.
  No further `text.ts` edits; its SHA-256 remains
  `d5696d6e42c9f171e63e392810756b22495af6a47bee3f32db345c0c4dd5b738`.
- Final GREEN: complete `text.test.ts` plus `cut-bom.test.ts`, serial Node test
  runner, 79 tests passed, zero failures/skips. This includes their maintained
  controls now explicitly authorized by root; no new resource probes were added.
- Final focused strict no-emit types: `text.ts`, `text.test.ts`, and
  `cut-bom.test.ts` roots plus imports, unchanged package compiler options,
  incremental:false; zero diagnostics. Owned whitespace check passes.
- Additional logs in the same approved `587-cut` directory:
  `existing-assertion-red.log`, `full-text-green.log`, `final-types.log`.
- All four owned files are frozen. Root owns literal registration, exact-file
  commit/push/release and transfer of `text.ts` to #586 after committing #587.
  The earlier pending-assertion note is resolved, not a remaining blocker.
