# ExifTool implementation increments

Status: incomplete. This document keeps every E01–E24 acceptance group open.
The initial independent scalar and PNG increments do not close the complete
engine, format/catalog, prerequisite-parser, compatibility or delivery gates.
The existing research, engine review and compatibility QA remain authoritative
for the full requested scope.

The registry records supplied source pin ExifTool 13.59,
`2200871d9cef988051d2a99d67df3bda6cbb30a8`, archive SHA256
`e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5`.
This increment reconstructs supplied behavioral controls in original JavaScript.
The pinned codeload archive was also downloaded and its exact SHA256 verified
before development-only source inspection and the fresh controls below.
No upstream implementation was copied or transpiled; a source adaptation still
requires the planned license/attribution review.

## Increment controls

Tests were written and executed failing before implementation. Additional failing
assertions reproduced NUL/trailing whitespace, no-op publication, unsupported
reader admission, enrolled output cancellation, invalid byte argv and missing
PNG structure. Production logic lives exclusively in the private command package.
Safe-bash adds one opt-in composition export and no default command registration.

Scalar controls preserve numeric spelling and provenance without JS Number
coercion. PNG extraction retains exact stored keyword, chunk index/type, byte
offset, duplicate instance, group, raw bytes and interpreted value. Selected
text edits preserve IHDR/IDAT/IEND and unknown chunks byte-for-byte, including
CRCs. A supplied base fixture's damaged IDAT CRC was repaired with an independent
development-only Node zlib checksum; product parsing does not use zlib.

Input bytes are admitted before copying/reading. Decoded UTF-16 extents, retained
owned input/raw metadata/string/array storage, output including backups,
byte visits/checksum loops, assignment comparisons and output concatenation
are bounded conservatively. No recursive parser is admitted. Signals are required
on byte-engine APIs. Invocation cleanup closes acquisition admission, drains
admitted VFS work, removes owned staging on its own explicit signal, and awaits
enrolled cooperative stdout/stderr writes. Cleanup failures remain observable.

Fresh manual controls (not unit tests) used CRC-correct original one-pixel PNG
fixtures and the pinned Perl CLI with `-config ''`, clearing `PERL5OPT` and
`PERL5LIB`. Seven values crossed ordinary JSON/JSONQ/s3 (21 invocations), all
status0 with empty stderr. These establish backspace/form-feed JSON escapes
`\\u0008\\u000C`, trailing LF/TAB becoming dots in Printable, NUL removal before
space trimming, preserved nonbreaking space, and the pinned end-anchor nuance:
`123` or `true` plus one final LF is emitted unquoted with that LF; two final
LFs are quoted. JSONQ always quotes and escapes them. Failing edge assertions
were added before correcting these mismatches.

Eight fresh write controls establish the exact invalid Title shift warning plus
`Nothing to do.`, no-op removal's zero-updated/one-unchanged summary, and same-value
assignment's updated summary and backup despite byte-identical native output.
Numeric shifts `2`, `0`, `1.5`, `-1` on nonnumeric Title emit a native warning but
succeed unchanged; the product explicitly refuses numeric shifts until the full
shift engine is admitted. Matching these numeric-shift controls remains open.
Native same-value assignment can preserve metadata chunk placement; exact writer
output and all native publication controls are still independent acceptance gates.

Seven original CSV controls establish union headers across files, omitted
never-found headers, `-f` placeholders, repeated-file rows, priority-winning
duplicate suppression and retained NUL/01/DEL/newline values. CSV bypasses
Printable, doubles quotes and quotes delimiters, newlines and edge whitespace.
ValueConv-qualified CSV headers and combined binary/import/output modes are
explicitly refused pending independent qualification. The invocation-owned table
charges cumulative storage and work before allocation and emits no partial table
when admission fails. Multi-file read summaries go to stderr.

Three pinned JSON G4 controls establish `Copy1:Title`, `Copy2:Title` and primary
`:Title` tokens, repeated-selector suppression and `:MissingTag` placeholders.
Independent review additionally executed uppercase `-G4` versus lowercase `-g4`:
lowercase is nested grouped JSON and is independently refused by this increment.
New PNG text is written before the first IDAT; image chunks stay byte-identical.
A fresh tEXt-only write control retained two rewritten same-key chunks rather than
collapsing them. The supplied collapse behavior is implemented, but this fixture
difference leaves complete native duplicate-writer qualification open.

A different agent independently reproduced repeated JSON tokens, multiplicative
selection work/retention, CSV literal filenames ending in `#`, and quadratic
missing-value matching. These were repaired with original regressions, token
suppression, pre-admission and an invocation-local membership Set. A further
failing multi-file write test reproduced fresh per-file engine accounting resets;
the command and PNG APIs now share the invocation's resource ledger. Exhausted
resource admission propagates instead of continuing as a per-file format error.
Review caught a resulting cumulative-output/local-size mixup; a failing two-file
byte-equality and reinspection test now proves local allocation sizes remain
independent of cumulative accounting. Final independent bounded review passes
all 64 package tests and reports no remaining blockers within this increment;
this does not qualify the complete engine or close any E01–E24 group.

## Acceptance groups

| Group | Tested increment | Still open |
| --- | --- | --- |
| E01 | PNG text case normalization; duplicate instances, last-winner extraction and JSON G4 tokens | Shortcuts, wildcard selectors, other family/group combinations and cross-format priorities |
| E02 | Short/compact/value styles; LF versus binary no terminator | Descriptions across catalogs, tabs, separators and complete flag precedence |
| E03 | Supplied 20 scalar controls, lexical boundaries and JSONQ | All format/list/structure conversion policies |
| E04 | NUL/controls/DEL, distinct raw provenance, UTF-8 argv admission | Charset/binary Base64/Unsafe qualification; non-UTF-8 argv refused |
| E05 | Qualified/XMP iTXt explicitly refused | Namespace-aware XMP lists, structures and language alternatives |
| E06 | None | Endian EXIF/IFD/rationals/cycles/maker notes |
| E07 | None | JPEG EXIF/XMP/ICC and pixel controls |
| E08 | Uncompressed text, UTF-8 writes, tIME, duplicates, CRC/length, IHDR encoding checks, unknown and image chunk preservation | Compressed/language PNG metadata, full PNG structural and writer qualification |
| E09 | None | TIFF/BigTIFF offset/count/page and unknown-tag controls |
| E10 | Accurate unsupported PDF diagnostic distinguishes deletion from redaction | Required shared PDF parser; Info/XMP/encryption/revisions/rollback |
| E11 | Explicit independent Office writer refusal | DOCX/PPTX/XLSX property inspection and package safety controls |
| E12 | Last scalar assignment, empty delete, exact matching removal, scalar += refusal | Lists, shifts, empty stored values and complete warning/output streams |
| E13 | None | TagsFromFile and protected/unsafe destinations |
| E14 | Standalone all= on admitted text-only PNG; selected deletion preserves unknown chunks | Group/unknown/format-wide deletion and historical metadata controls |
| E15 | PNG tIME fixed-width EXIF/ISO assignment, discarding explicit offset/subseconds without ambient timezone conversion; raw/ValueConv separation and deletion | Broader native date grammar, temporal shifts, warning/no-op policies, timezone/subsecond tags and VFS file time |
| E16 | Bounded CSV extraction with union headers, quoting, retained stored controls and missing placeholders | JSON/CSV import and precise SourceFile/group/exclusion/empty policies; full CSV group/charset/binary policies |
| E17 | None | Fast/unknown/embedded traversal profiles |
| E18 | Virtual path resolution; symlink input refusal | Recursive scanning, sorting, hidden/extensions/charsets and mapping |
| E19 | Single-input exclusive -o, source/destination collision preservation | w/W/percent/append and broader output mapping |
| E20 | Single-link replacement, byte-identical backup, existing sentinel retention, in-place inode/hardlink propagation; failure/cancel staging cleanup | Default/overwrite hardlink replacement refused by VFS contract; permissions/races/rollback profiles remain open |
| E21 | Nonempty config/eval/interpolation controls refused without execution | Complete versioned option inventory and bounded declarative alternatives |
| E22 | VFS UTF-8 argument-file expansion, BOM/physical-line/comment/CSTR/whitespace rules, insertion order and bounded nesting | Stdin, non-UTF-8 charsets, full option interactions and broader native qualification |
| E23 | Execute/stay_open explicitly refused | Invocation-local bounded readyN protocol and option resets |
| E24 | Selected missing/empty/unknown controls and failure status1 | Conditional status2, quiet/warning streams, execute-batch aggregate semantics |

## Remaining verification and next increments

Complete the shared PDF parser prerequisite before admitting PDF metadata writes
or revisions. Qualify reusable Office ZIP/XML capabilities before adding Office
inspection; no Office writer is authorized. Add failing original fixtures for
the remaining namespace/compression/endian/date/import/protocol cells in reviewed
increments. Do not infer support from extensions, reader admission, a passing
scalar test or a packaged export.

The in-memory package test exercises private runtime/declaration closure and an
isolated scalar consumer. Actual Shell composition separately verifies canonical
argv, byte pipelines, writes and VFS script invocation. Full isolated installed
SDK/Shell/declaration consumer qualification is a separate gate, not implied by
these unit tests.

Manual packed/visual QA steps (development only):

1. Run maintained `npm run build`, package lint/typecheck/unit commands, repository
   lint and `npm test`. Record actual outcomes rather than counting missing tasks.
2. Generate safe-library artifacts under task-owned `/out` using
   `scripts/package-safe.mjs` with an explicit development version.
3. Place only generated safe-bash/safe-fs artifacts into an isolated consumer's
   package resolution path. Import `/commands/exiftool` and the root Shell without
   private workspace links. Exercise Title writes and a binary extraction pipe;
   inspect constructor/runtime identity and typecheck a strict NodeNext consumer.
4. Capture actual Shell output with the maintained generic screenshot route into
   task-owned `/out`, inspect it, and purge temporary artifacts/evidence afterward.
5. Native publication/PDF controls remain opt-in Markdown QA. Native Perl is a
   development oracle with `-config ''`; it is never a product runtime.

No command package publication is authorized. No push was requested; local work,
remote-main delivery and successful releases must be reported separately.

## Verification evidence

- Maintained normal root `npm run build` passed. The maintained explicitly
  selected safe-bash build closure subsequently passed all 12 selected build
  tasks, followed by a final command-package rebuild after the lowercase-group
  repair. No build task membership was synthesized.
- Repository `npm run lint` passed with zero errors and four warnings. The final
  command-package lint and both source/test typechecks passed after code changes.
- All 64 command-package memory tests pass. The actual Shell public composition
  test passes byte pipelines, CSV extraction and VFS script execution. The
  maintained package-artifact suite passes all 144 tests.
- Final artifacts were copied, rather than symlinked, into an isolated consumer
  with only generated public safe-bash and safe-fs packages. Public root/Shell,
  command and contract imports passed shared runtime-identity checks, multi-file
  writes with exact backups and equal output extents, raw/lexical SDK extraction,
  duplicate JSON-token suppression, G4 policy, CSV and binary pipelines. A strict
  NodeNext declaration consumer passed without skipLibCheck. AST inspection of
  32 bundled implementation/contract JS/declaration modules found no bare
  unpublished-package dependency; existing published safe-fs type imports resolve.
- The final packed Shell output was captured through the maintained generic
  screenshot route and visually inspected for aligned names, qualified JSON,
  CSV fields and compact missing placeholders. No screenshot tests were added.
- Root `npm test` shared phase passed 129,701 tests with two explicit skips.
  The full maintained workspace phase finished with exit1 and remains a failing
  gate: eight controls have been independently reproduced. Two
  committed-archive assertions encounter `committed build input differs from
  reviewed authority: scripts/build.mjs` before their expected checks. Two native
  arithmetic quoted-operand controls encounter status1 from PATH-selected
  `/bin/bash` 3.2.57; corresponding virtual-shell assertions pass. Four scalar/
  indexed replacement/removal cancellation controls in `string-operations.test.ts`
  observe three code-point reads rather than their exact required two; focused
  reproduction confirms all four failures. No authority comparison, assertion,
  timeout or supported-version policy was weakened. The runner stops on the failed
  workspace, so unexecuted later tasks are not counted as passes. These failures
  remain open; the package and packed-consumer checks do not replace the full gate.

Filesystem-root `/out` was unavailable; task-owned temporary sources, logs,
artifacts and screenshots used repository `out/`. They are purged after durable
verification capture. All unrelated worktree edits remain preserved. No local
commits, remote-main delivery or release/publication are claimed.

## Subsequent behavior increment and review

The current behavior task reproduced three failing PNG edge tests before adding
UTF-8 writes, lone-surrogate refusal and malformed IHDR encoding refusal. It then
reproduced three failing timestamp tests before admitting PNG tIME extraction,
fixed-width EXIF/ISO normalization, assignment and deletion. Follow-up failures
proved that binary output must retain ValueConv for tIME and stored Latin-1 text,
and that oversized stored timestamp fields need separators independent of field
width. SDK raw bytes remain independent of converted output. Registry version 2
adds ModifyDate and advertises the independently admitted PNG text/time profile.

Fresh development controls downloaded the exact pinned archive again and verified
the supplied SHA256 before execution. Native Perl used `-config ''` first and
cleared PERL5OPT/PERL5LIB. `café`, `café 水😀` and
`2024-02-29T12:34:56.789+05:30` produce byte-identical PNG files in the native
control and product writer, including every image chunk and CRC. Native -b on
stored Latin-1 café emits UTF-8 `636166c3a9`; -b ModifyDate emits converted date
text without a terminator. Native timestamp subtraction is a temporal shift,
not scalar matching removal; both timestamp += and -= remain explicitly refused.

The timestamp policy is deliberately limited to the documented fixed-width syntax
and ranges. Native wider grammar, hour 24/leap-second normalization, invalid-date
warning/no-op behavior and calendar validation are not qualified. No ambient
clock, timezone, process, file, network or dependency capability was introduced
into product code. Encoded UTF-8 extents are calculated before allocation;
retained/output/work admissions cover UTF-8 buffers and emitted chunks. The
existing publication/cleanup implementation is reused directly.

Review found no proxy-only function or shared-framework addition in this increment.
Common tag identity/instance construction serves both text and tIME rather than
duplicating identities. Every E01–E24 group remains open. The full pinned format
catalog, shared PDF parser/reversible writer, namespace-aware XMP, TIFF/EXIF,
Office inspection, imports, scanning, argfiles and execute protocol remain
unresolved and block completion of behavior-exiftool. The previously recorded
full-suite failure gate is not cleared by focused checks.

Further native review proved that a tEXt keyword named ModifyDate survives a
tIME assignment. A failing regression reproduced its accidental removal; the
registry now derives admitted tag names from writable chunk-type declarations.
Timestamp edits target tIME and preserve the colliding unknown text exactly.
The resulting original fixture also matches native output byte-for-byte.

Current increment verification: all 75 in-memory command-package tests pass,
package lint and source/test typechecks pass, the final maintained selected
safe-bash build closure passes, the expanded Shell/pipeline/script integration
passes, all 356 maintained build tests and 144 package-artifact tests pass.
Generated public artifacts copied into a consumer pass root/command imports,
registry-v2 checks, Unicode/timestamp writes, exact backup and binary ValueConv
checks. A strict NodeNext declaration consumer passes without skipLibCheck.
No bare private command/contracts import was found in the generated artifact
runtime/declaration tree. This copied consumer is under repository out; historical
fully isolated-consumer qualification is separate evidence, not renewed by this
increment. The screenshot was captured and inspected; aligned date/text/JSON
presentation passes, but CJK/emoji appearance remains unqualified because of
missing renderer glyphs. Current exact-byte checks verify their text independently.
All task-owned native sources, generated consumers/artifacts and screenshots are
purged after evidence capture. No local commit, remote-main delivery, release or
command publication is claimed. Unrelated contributor edits are preserved.

## Bounded argument-file behavior increment

E22 remains open. Failing original tests preceded the physical-line filter and
VFS expansion implementation; follow-up independent controls exercise literal
`--`, option values named `-@`, malformed UTF-8, nested depth, argument counts,
reused streamed buffers and cancellation finalization. A separate failing test
reproduced path-normalization scratch allocation before resource admission;
normalization now admits decoded/retained/work extents before splitting a path,
including separator-only inputs whose final normalized name is short.

Argument files expand in place with initial BOM removal, physical LF/CRLF lines,
first-column comments, preserved quotes/trailing spaces, assignment whitespace
normalization and pinned CSTR escapes. Unknown CSTR escapes remain literal;
`\\0`, `\\x41` and `\\v` are not interpreted. Empty CSTR produces an empty argument.
All source file bytes, decoded strings, retained arguments, path scratch, chunks
and parsing work share the invocation ledger. Reads are enrolled in existing
cleanup before acquisition; owned fragments survive producer reuse/finalization.

Seven fresh development-only native controls used the SHA256-verified pinned
source with `-config ''`, PERL5OPT/PERL5LIB removed, and `-echo`/`-ver` to observe
arguments independently of metadata parsing. Every control returned status0,
empty stderr and exact matching physical-line output. The reproducible original
cases are in `argfiles.test.ts`; the manual procedure is in
`safe-bash-exiftool-argfile-qa.md`.

Bounded deviations are explicit: regular UTF-8 VFS files only, current-directory
resolution without executable-directory fallback, no stdin or symlink argfiles,
no cycles, at most 15 included-file nesting levels and 4096 expanded arguments.
Config/common_args in files fail explicitly; execute/stay_open/polling remain
unsupported. Full charset/option-interaction and E22 qualification remain open.

Current checks: all 84 memory command-package tests pass with zero skips; package
lint and source/test typechecks pass. Targeted real Shell composition passes
argfile extraction through a byte pipeline and insertion-order writes alongside
the existing script/Unicode/timestamp controls. Its changed test file also passes
ESLint. The selected maintained safe-bash workspace build closure passes.
Generated public safe-bash/safe-fs artifacts are copied into a consumer; nested
argfile writes, exact original backups, raw/Printable/JSON distinctions and cycle
diagnostics pass. Strict NodeNext declaration checks pass without skipLibCheck.
The screenshot is captured through the maintained generic route and inspected:
aligned text, escaped JSON and cycle diagnostics render legibly.
The final revision is rebuilt and repackaged before repeating the copied-consumer,
declaration, Shell and screenshot controls. This renews Node.js 22 qualification;
browser/workerd runtime variants remain unverified. Budget tests are deterministic
admission controls, not throughput or wall-clock performance measurements.

The first safe-bash workspace test invocation unexpectedly started all discovered
tests: its runner does not honor SAFE_BASH_TEST_RG. Only this task's process tree
was stopped (exit143), with no reported test failure before interruption. This
is an incomplete broad run; the targeted direct integration is not a completed
broad gate. No fresh full `npm test`, repository-wide lint or normal root build
is claimed for this focused command increment. Historical broad failures above
remain unresolved. A manual backup assertion initially compared Uint8Array with
Buffer prototypes; matching byte-container types repaired the QA fixture without
changing product code or relaxing byte equality.

No acceptance group is closed. PDF parsing/reversible writes, namespace-aware
XMP, EXIF/TIFF/JPEG, Office inspection, imports, catalog completeness, scanning
and protocol cells still prevent completion of behavior-exiftool. No new runtime
dependency, host executable/file/network access, user code evaluation, package
publication, local commit, push or release is introduced by this increment.
Filesystem-root `/out` does not exist in this environment; task-owned temporary
sources, artifacts, logs, manual drivers and screenshots used repository `out/`
and are purged after recording this evidence.


## Command wiring: stdin extraction verification

The command-exiftool wiring task inspected the existing private command,
canonical contracts, opt-in safe-bash export and qualified artifact graph.
Three original failing memory regressions reproduced rejection of the requested
`-` input, missing stdin resource admission and absent early refusal diagnostics.
The command now admits one stdin extraction stream through the existing enrolled
invocation lifecycle. It forwards cancellation, charges input/decoded/retained/work
before fragment copying, owns reused producer fragments and finalizes producers
on admission failure or cancellation. No VFS stat is fabricated for stdin.
Stdin editing and repeated stdin operands are explicit unsupported deviations;
no native write/output profile is inferred from extraction support.

All 87 command-package memory tests pass, as do package ESLint/source/test
typechecks and the changed Shell integration's ESLint. The maintained selected
safe-bash workspace build closure passes all 12 declared build tasks. The actual
Shell composition test passes stdin PNG JSON extraction alongside existing
pipeline/script/write/argfile controls. All 144 maintained artifact tests pass.
Generated public safe-bash/safe-fs artifacts copied into a consumer pass public
imports, PNG writes, typed lexical metadata and stdin text/JSON/JSONQ/CSV/binary
pipelines. Strict NodeNext declarations pass without skipLibCheck. The generic
screenshot route captures that consumer's Shell output; visual inspection confirms
aligned names and legible JSON/CSV. Temporary artifacts and screenshots are purged.

This is focused Node.js command/export verification, not full pinned catalog or
native stdin qualification. No new shared build integration was needed. No fresh
full root test/lint/build gate or browser/workerd qualification is claimed;
previous broad failures remain open. Full format compatibility, imports, scanning,
PDF/XMP/EXIF/Office engines and execute protocols remain unfinished as recorded
above. Default registration is unchanged. No command publication, local commit,
push, remote-main delivery or successful release is claimed. Unrelated edits
are preserved.
