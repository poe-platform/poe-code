# ZIP compliance

## Objective and reference

Make safe-bash's ZIP command fully compliant. Use Info-ZIP 3.0's Unix CLI and
the ZIP format specification as behavioral references; preserve the virtual
filesystem and explicit resource/capability contracts. A passing subset does not
establish completion. Native compression bytes may vary by encoder, but archives
must interoperate and option effects, selection, metadata, diagnostics, statuses
and filesystem effects require direct evidence.

## Remaining work and acceptance

1. Complete argument grammar: long options, short groups and two-character options,
   negation, attached/separate values, list terminators, literal paths, ZIPOPT,
   usage/version/license/options output and diagnostic statuses.
2. Complete selection: stdin names (`-@`), source wildcard expansion, `-R`, `-nw`,
   `-ws`, include/exclude lists, date ranges and platform case behavior. Verify
   recursive paths, symlinks (`-y`), omitted directories (`-D`), source/output aliases,
   permissions, missing and unreadable files and quoted/raw filename bytes.
3. Complete archive operations: update/freshen, delete/copy, file synchronization,
   separate output, move, entry/archive comments, archive timestamps, suffix-based
   storage, metadata stripping/preservation, line-ending conversion and integrity
   testing. Verify unchanged payload preservation and publication failures.
4. Complete streaming: stdin members, stdout archives, default filter invocation,
   data descriptors, backpressure, cancellation and cleanup ownership.
5. Complete formats: ZIP64, supported compression methods, legacy encryption,
   split archives, self-extracting prefixes, adjustment, recovery and extra fields.
   Gather spec/oracle evidence before changing each format admission rule; no native
   executable fallback is permitted. Limits remain explicit rather than silently
   treating unsupported operations as successful.
6. Qualify interoperability, exact option/selection/status effects, binary data,
   Unicode and metadata with independent native captures and deterministic memory
   tests. Capture native oracles manually in isolated temporary directories;
   canonical unit tests neither invoke native tools nor create host files.
7. Deliver atomic commits on main with scoped verification and GitHub publication
   evidence. User requests continued implementation while releases run: inspect
   live release handles alongside work, without blocking progress on publication.

## Evidence already established

- `d7c6149d8`: `-j`; 203 scoped ZIP/unzip tests and lint passed. Scoped package
  publication succeeded as `@poe-platform/safe-bash@0.1.610`.
- `fa0d51bf1`: `-i`/`-x`, source-path filtering before `-j`, `@` terminators,
  excluded-input reads, existing-member preservation and empty inclusion behavior.
- `22066cd6a`: `-0` through `-9`, last-level precedence and zlib interoperability.
  These two improvements have been verified on remote main. Publication must be
  inspected independently; local delivery alone is not release evidence.

The maintained ZIP documentation currently explicitly lists format gaps. Remove
each stated limitation only after its actual implementation and acceptance evidence
exist. The objective remains open until all remaining areas are proved.

## Stdin filename implementation

Native Zip 3.0 captures established stdin-before-argv ordering, blank-line skipping,
trailing-CR removal, preserved spaces/tabs and final unterminated lines. `-@` now
uses the ZIP invocation's tracked source ownership, bounded byte collection and
combined operand/path/work admission. Nine memory tests cover those behaviors,
fragmented UTF-8, repeated flags, rejection without publication, empty input and
draining a held input read before cancellation settles. Native captures are manual
observations, not a complete CLI compliance gate.

## Directory-entry omission

`-D` now prevents selection of new directory entries while preserving recursion
and existing archive directory members. Three memory cases cover recursive
selection through unmatched parents, retained old directories and the nonrecursive
directory-only status 12. Manual native Zip 3.0 observations confirm those effects
and the empty-inclusion behavior when the included directory is omitted.

## Symlink storage

`-y` selects symlink metadata and reads target bytes without resolving the final
link. Initial and post-read snapshots resolve only its parent and check backing
identity, type, size and times before publication. Three memory cases verify live
and broken targets, stored mode/payload, recursion with cycles and escaping targets,
`-j` flattening and replacement detection preserving an old archive. Manual Zip 3.0
captures confirm symlink storage and recursion effects. Default dereferencing and
extraction confinement remain part of regression acceptance.

## Integrity testing

`-T` reads the serialized candidate, then streams and discards decoded payloads
with actual aggregate accounting before publication. Tests cover successful
stored/deflated binary output, quiet suppression, retained CRC and malformed or
trailing DEFLATE, rejected empty results and symlink payloads with file-only
accounting. Manual Zip 3.0 captures establish OK output, quiet suppression and
empty-result status 8 with no published archive. Embedded native UnZip diagnostics
and temporary-name formatting remain a CLI fidelity gap; integrity-test support
does not close the overall compliance goal.

## Archive deletion

`-d` matches operands against archive names and applies inclusion/exclusion without
source filesystem reads. Retained members are copied unchanged, deleted progress
and empty warnings are budgeted before publication, and unmatched names have native
warnings/status 12. Five memory cases verify absent source trees, exact retained
entries/comments, combined filters, all-member deletion, empty integrity rejection,
ignored recursion and missing archives. Manual Zip 3.0 captures establish those
statuses, channels, diagnostics and member effects. Integrity-test progress is
flushed before validation to retain progress on test failure; default creation
still emits completed progress after publication.

## Update and freshen

`-u` and `-f` compare whole-second modification times before reading source bytes;
update adds new members, freshen does not. No-operand invocation selects existing
archive names. Unchanged invocations return status 12 silently without publishing.
Nine memory cases verify fractional-second skipping, newer replacements,
no-operand selection with filters, new-member distinctions, incompatible action
diagnostics, skipped payload reads and absent-archive freshening. Manual Zip 3.0
captures establish the same behaviors, including odd-second Unix timestamps,
freshening progress, missing-archive warnings and update's empty-inclusion result
when creating a missing archive. Format/metadata dialect coverage still requires
the remaining independent compatibility qualification.

## Suffix storage

`-n` accepts colon-separated suffixes and attached/equals values. Native Unix
captures revealed and validated existing default-list defects: suffix matching
is case-sensitive and level 9 overrides storage suffixes. Nine memory cases cover
default/custom matching, case, level-9 precedence, empty defaults, cleared lists
and binary round trips. Matching storage suffixes bypass compression work rather
than compressing and then discarding the result.

## Long options and attached lists

Native long spellings now normalize to implemented short flags without changing
original argv indices or raw-byte admission. Exact names and unique abbreviations
are supported; reserved unimplemented Unix names retain native prefix ambiguity
instead of accidentally enabling a different short option. Native captures also
validated a parser defect: attached `-iVALUE`/`-i=VALUE` and `--include=VALUE`
consume only one value, and empty attached inclusion is valid. Fifteen memory
cases cover grouped semantic effects through long aliases, abbreviation ambiguity,
invalid values, unsupported options, attached includes before archive, empty
inclusion, action aliases, stdin/suffix aliases and literal long-looking paths.
Unimplemented native option aliases remain explicit failures, not completion.

## Explicit compression method

`-Z`/`--compression-method` selects store or DEFLATE with case-insensitive unique
prefixes and attached/separate/equals values. Native captures revealed a precedence
gap: `-0` selects storage, and later effort flags do not re-enable compression;
explicit `-Z deflate` does. Ten memory cases cover method selection, precedence,
round trips, unknown/missing method values, disabled bzip2 status 19 and native
level-zero/DEFLATE status 5 preserving old archive bytes. The current native Unix
Zip build also lacks bzip2, but adding method-12 format support remains in scope
for the broader ZIP objective and other enabled native profiles.

## Stdin member payloads

`zip ARCHIVE -` now collects bounded binary stdin into the `-` member through one
lazily acquired, invocation-owned iterator shared with filename-list consumption.
Repeated operands do not reacquire input; filtered payloads do not acquire it at
all. Native pipe mode `010660` is serialized without adding incompatible regular
type bits. FIFO-mode ZIP payloads are admitted as data and extracted as regular
files, retaining permission bits and never creating a FIFO. Native Zip/UnZip
captures validate member naming, repeated operands, pipe metadata and regular-file
extraction. Seven stdin memory cases cover binary integrity/extraction, duplicates,
excluded input, EOF after filename lists, bounded rejection preserving an archive
draining cancellation and a native-validated collision with a literal `./-` source.
Format and extraction cases also cover FIFO admission
while continuing to reject device/socket modes. Native stdin ZIP64 records,
stdout archives and default filter invocation remain in scope and unimplemented.

## Stdout archives and default filter invocation

`zip - FILES...` bypasses archive filesystem metadata/publication entirely and
writes binary bytes through owned stdout operations; progress and fatal messages
use stderr. Default no-archive invocation selects stdin's `-` member, while explicit
`zip -` without operands returns 12. Stream format writing now emits signed data
descriptors with correct flags, extraction versions, offsets, sizes and CRCs.
Default DEFLATE is retained even for expansion; file-output mode keeps its existing
stored fallback. Native captures establish channel separation, negative compression
progress, default filter behavior, ignored stdout `-T` and action rejection.
Nine memory cases cover those effects, no-filesystem filter invocation, output-only
budgeting, Shell binary pipelines/limits and draining enrolled cancelled writes.
Incremental serialization, ZIP64 stdin records and the remaining option/format
areas are still open; bounded prepublication candidate construction is not a
claim of complete streaming parity.

Manual interoperability verification generated an actual virtual stdout archive
for a one-byte file, then read it with native UnZip and Python's independent ZIP
reader in an isolated temporary directory. UnZip returned 0 and the exact `a`
payload; Python confirmed DEFLATE, descriptor flag 8 and extraction version 20.

## ZIP64 reader and classic transcoding

Native Zip 3.0 captures include valid stdin and forced-ZIP64 file archives, plus
a malformed forced-stdout archive rejected by native UnZip. The reader resolves
single-disk ZIP64 end records, locator and ordered size/offset/disk extra fields
under existing budgets. Classic rewriting strips obsolete ZIP64 tags.
Tests cover all 16 sentinel combinations, every shorter required field payload,
every truncated native archive prefix, disk/count/span inconsistencies, unsafe
uint64 values, size mismatches, metadata tag ordering and extensible end records.
Public inspiration: CPython test_bad_zip64_extra,
test_generated_valid_zip64_extra, test_zip64_extensible_data and extra stripping
order cases: https://github.com/python/cpython/blob/main/Lib/test/test_zipfile/test_core.py
Tests adapt to this bounded single-disk profile. ZIP64 output remains open.

Verification: 394 focused ZIP/unzip tests passed, including signed/unsigned
64-bit descriptor mutations. Scoped ESLint passed. Both valid native captures
were transcoded through the actual reader/writer; native UnZip integrity checks
returned 0 for both resulting classic archives.

## Forced/default stdin ZIP64 output

Native Zip captures confirm default stdin ZIP64, -fz and --force-zip64 force,
-fz- and --force-zip64- disable, and last-switch precedence. Added ZIP64 local
and central size/offset tags, 64-bit end records and locators, and signed 64-bit
stdout descriptors. Forced output stays under existing archive/member budgets.
412 focused ZIP/unzip tests pass, including Unicode names, empty/compressible
bodies, comments, mixed-width members, descriptor forms, overflow and switching.
Native UnZip integrity checks and Python zipfile verify exact Unicode member
payload and archive comments for output with and without descriptors.
Incremental serialization, automatic large-archive/count escalation and the
remaining option/format areas are still open.

## Incremental record serialization

Replaced the whole-archive serializer with a shared bounded async byte iterator.
Local records, payload slices, signed descriptors, central records and end records
are emitted in wire order. File publication collects this iterator; stdout
consumes it directly under the owned output operation signal and backpressure.
Complete metadata validation precedes the first archive chunk. Every emitted
chunk owns its bytes and is bounded by configured chunkSize.
418 focused ZIP/unzip tests pass, covering wire round trips, mixed ZIP64, large
metadata/comments, complete pre-output admission, mid-stream cancellation,
backpressure and sink rejection. Scoped lint passed. Actual stdout command
emitted five writes; native UnZip integrity and Python exact-payload checks passed.
Built-package type checking was not executed because required dist prerequisites
are missing. Source collection/compression still buffers member payloads; true
end-to-end input streaming, large-archive escalation and remaining format/options
remain open.

## Metadata stripping and all-extra updates

Native Zip confirms -X/--strip-extra strips optional fields on rewritten members,
-X-/--strip-extra- preserves unknown fields and regenerates metadata, and
untouched members keep original extras. Forced ZIP64 retains required fields.
Added native-compatible negation and last-switch precedence. Rebuilt size,
timestamp and Unicode metadata cannot retain stale values from old members.
430 focused ZIP/unzip tests pass, including selected/untouched members, opaque
ordering, regenerated timestamp uniqueness, extra budgets, odd-second DOS time,
file/stdout ZIP64 essentials and switch ordering. Scoped ESLint passed. Native
UnZip and Python verify exact payload and only the essential ZIP64 central tag
in actual stripped stdout output. Remaining option and format areas stay open.

## Forced descriptors and update preservation

Native Zip confirms -fd/--force-descriptors is one nonnegatable option, not
freshen plus delete. It forces DEFLATE for nonempty regular files, keeps empty
files stored, omits directory descriptors and respects storage selection.
Forcing descriptors applies only to rewritten members; untouched members
do not receive forced descriptors. Native updates normalize existing copied
descriptors to ordinary headers; kept that reader/writer behavior and added
per-entry forced selection. Invalid native forced-ZIP64 variants are not reproduced;
output retains valid end records and locators.
441 focused ZIP/unzip tests pass, covering aliases, nonnegation, tiny/empty/dir
members, storage precedence, ZIP64+stdin+integrity+stripping and untouched
normalization. Scoped lint passed. Native UnZip integrity and Python exact
payload/descriptor/DEFLATE checks pass for actual one-byte file output.
The X metadata release (35009959837) succeeded; remaining compliance work is
still active.

## Wildcard matching controls

Native captures establish -ws/--wild-stop-dirs: single star and question mark
stop at slash, double star crosses slash, explicit slash character classes
remain legal. -nw/--no-wild disables stars, brackets and backslash escaping
but native Unix question-mark matching remains active. Neither is negatable.
Added optional matcher configuration without changing default UnZip semantics,
and applied controls to include/exclude and archive-delete selection.
461 focused ZIP/unzip tests pass, covering nested depths, literal metacharacters,
question marks, slash classes, double stars, aliases, exclusions, deletion and
nonnegation. Scoped ESLint passed. Independent native/actual virtual stdout
archive comparison confirms identical selected names and payloads for single
and double-star patterns. Filesystem operand glob expansion and recursive-pattern
mode remain open, alongside streaming and other option/format areas.

## Recursive-pattern selection

Native Unix Zip does not expand quoted filesystem operands; validated existing
status-12 behavior rather than introducing nonnative glob expansion. Native -R
scans current directory and matches trailing path components. Implemented the
public Info-ZIP fileio.c filter algorithm: R and i must both match, x wins.
Source: https://github.com/LuaDist/zip/blob/master/fileio.c (filter).
472 focused ZIP/unzip tests pass, including basename and path-tail patterns,
hidden files, directory names, aliases, ws interaction, include/exclude priority,
-r/R conflicts, absent patterns and no-match nonpublication. Native captures
validate these results. Scoped lint passed. Remaining argument, diagnostic,
streaming and format areas remain open.

## ZIPOPT defaults and Unix tokenization

Native captures and public Info-ZIP util.c envargs establish prepend order,
ZIP_OPTS fallback for blank ZIPOPT, ASCII whitespace and token-start double
quotes with quoted backslash removal. Single quotes and unquoted backslashes
remain literal; adjacent quoted/unquoted text produces separate arguments.
Source: https://github.com/LuaDist/zip/blob/master/util.c (envargs/count_args).
Added bounded environment parsing without replacing original argumentValues
identity checks. Raw environment syntax and argv share argument budgets.
Include lists consuming the archive cannot trigger default stdout filter mode.
496 focused ZIP/unzip tests pass, including precedence/storage latches, fallback,
quote/escape boundaries, Unicode, empty patterns, shell-looking literals, NUL,
raw syntax budgets, unknown options and missing-archive diagnostics. Scoped lint
passed. Native/actual virtual archives agree on quoted include selection/payload.
Remaining grammar, streaming, metadata and format requirements remain open.

## Date selection and DOS boundaries

Native captures and public Info-ZIP zip.c date cases/fileio.c dostime establish
inclusive -t/from-date and exclusive -tt/before-date. Numeric field widths,
signed and short fields, trailing text, pre-1980 clamping and day<=31 validation
are retained without calendar normalization. Local file times round upward to
DOS two-second boundaries, including crossing midnight. Date-filtered deletion
uses archive modified metadata and does not misreport existing names as absent.
525 focused ZIP/unzip tests and scoped lint pass, including compact/ISO formats,
invalid month/day, repeats, odd/even midnight, impossible-day ordering, high
years, empty intervals, deletion and unmatched diagnostics. Actual native and
virtual archives select identical midnight members and payloads. Remaining
argument/output, streaming, metadata and format requirements remain active.

## Archive copy mode and separate output

Native Zip captures confirm U/copy-entries requires O/output-file, no operands
copy all, --out without operands selects copy mode, and separate output always
requires existing input. Stdout archive argument ignores --out. Added separate
input admission and destination staging with same-path/backing-identity rejection.
Archive copy never reads member source files or inflates payloads. Native copy
progress prints only member names. Empty output basename maps to .zip.
541 focused ZIP/unzip tests and scoped lint pass, covering selection/intersection,
unchanged input, ordinary updates, existing non-ZIP destination replacement,
input directory absence, no-match, aliases, progress, stdout override and basename
boundaries. Independent native/actual virtual copied archives agree on names,
payloads and CRC/method/compressed/uncompressed sizes; source bytes stay unchanged.
Earlier date release 35014094327 failed on stale shared version 0.1.620 collision.
Remaining format, metadata, streaming and grammar work stays active.

## Must-match failures and archive fallback

Native captures establish MM/must-match is nonnegatable, missing add/delete
operands fail 18, existing archive names/patterns satisfy missing filesystem
names, junk paths apply to that fallback, and copy pattern misses retain 12.
Include/date exclusions are not unmatched names. Public Info-ZIP zip.c read
failure paths validate fatal unreadable-source behavior. Added lazy bounded
archive matching and fatal inspect/read errors before publication.
553 focused ZIP/unzip tests and scoped lint pass, covering aliases, unchanged
existing archives, partial stdout prevention, delete/copy distinctions, filters,
unreadable inspection/iteration, archive-only patterns and junk-path fallback.
Independent native/actual virtual commands agree on status 18 and unchanged
input bytes after a missing-name failure. Release 35014811868 remains live;
remaining grammar, metadata, streaming and format work stays active.

## File synchronization

Native Unix Zip captures and public Info-ZIP zip.c current/mark logic establish
FS/filesync replaces members when DOS time or size differs (including older
sources), deletes all entries outside the selected source set, and skips reading
current source payloads. A wholly current archive succeeds without publication;
empty source selection returns 12 without deleting anything. Different archive
actions are incompatible. Added bounded selected-name tracking and reused owned
publication, member copying and normal traversal. Eighteen memory cases cover
aliases, current/quiet status, older and size-only replacements, empty/missing
and excluded operands, action conflicts, separate output, no current-source reads,
recursive omitted directories, flattened collisions, resource rejection and
DOS two-second boundaries. Manual native captures were isolated from unit tests.
Reference: https://github.com/LuaDist/zip/blob/master/zip.c
Remaining line conversion, comments, formats, streaming and grammar stay open.

## Native character-class range grammar

Public Info-ZIP util.c recmatch and independent Zip 3.0/UnZip 6.0 captures
confirm trailing hyphens produce no range ([a-], [a-b-]) and chained ranges
use the immediately preceding character ([a-b-c] matches b through c). Fixed
shared tokenization while retaining leading/escaped hyphens, escaped closing
brackets, negative and empty classes and malformed-class rejection. Four initially
failing cases establish the prior mismatch. Fourteen memory tests cover the
grammar and actual ZIP deletion/UnZip payload selection with native statuses.
Reference: https://github.com/LuaDist/zip/blob/master/util.c
This closes the validated range mismatch; other matcher grammar and compliance
areas remain open.

## Archive comments

Native Unix Zip captures and public zip.c zipedit logic establish z/archive-comment
reads input after members, joins lines with CRLF, terminates only on exact dot-LF
or EOF, preserves CR/raw bytes and applies C-string NUL truncation. Comment-only
updates require a nonempty existing archive; update/freshen may edit without newer
members. Delete/copy ignore comments with native warnings; current filesync skips
editing. Implemented owned, bounded input parsing and raw budgeted prompt output
before publication. Initial twenty unsupported-option failures validated the gap.
Memory cases additionally cover fragmented Unicode, prompt bytes, format maximum,
overflow, empty-chunk work limits, cancellation drainage and shared exhausted stdin.
Public inspiration: CPython zipfile maximum/large-comment tests.
Native UnZip integrity and Python independently verified the actual binary member
and exact Unicode multiline comment in /tmp/safe-bash-zip-comment-result.zip.
Filesync scoped release 35015808387 successfully published safe-bash 0.1.622;
range release 35016159365 remains live. Remaining line conversion, entry comments,
streaming, formats and grammar stay open.

## Entry comments and shared input

Native Unix captures and public zip.c comadd establish c/entry-comments reads
one line per marked member in archive order after processing. LF is removed,
CR remains literal, NUL truncates, blank clears and EOF retains old comments.
Update/freshen can comment current members; delete/copy ignore with warnings;
current filesync skips. Added a bounded cursor shared by entry/archive comments,
with lazy acquisition when no comment input is needed. Initial fourteen failing
cases validated unsupported c; two more exposed invalid UTF-8 comment flags and
one proved unnecessary stdin acquisition. Nineteen memory cases cover those gaps,
ordering, grammar, current payload preservation, old EOF comments, resource
rejection, raw bytes with Unicode names, stale Unicode-comment metadata and the
65,535-byte fgets split. Required Unicode-path extras retain filename identity
after clearing UTF-8 for raw comments; changed comment CRC extras are removed.
Native UnZip integrity checks pass for normal and raw-comment generated archives;
Python independently checks exact Unicode entry/archive comments and binary data.
Reference: https://github.com/LuaDist/zip/blob/master/zip.c
Range release 35016159365 failed on previously published version 0.1.622;
archive-comment release 35016686051 remains live. Remaining line conversion,
move/timestamps, streaming, formats and grammar stay open.

## Classic member-count maximum and automatic count ZIP64

Native Zip 3.0 copy captures of 65,534/65,535/65,536-member archives establish
65,535 is still classic and ZIP64 directory escalation starts at 65,536. Added
compact captured end-record fixtures, admitted classic maximum input/output,
automatic wide end records for larger counts and saturated classic count fields.
Member size/offset widths remain independent. Initially failing reader/writer
cases validate the old 65,534 cap and classic maximum rejection. A further failing
comment fixture proves a count-only sentinel must not bypass ordinary EOCD span
checks. Fast directory-record tests cover native boundaries and configured caps;
real maximum-count writer metadata remains tested with scheduling mocked.
Manual complete writer/reader round trips generated both boundary archives.
Native UnZip integrity checks returned 0, and Python checked exact counts,
ZIP64 threshold, final member payloads and comments. Artifacts:
/tmp/safe-bash-zip-count-65535.zip and /tmp/safe-bash-zip-count-65536.zip.
Archive-comment scoped release 35016686051 succeeded. Entry-comment release
35017363897 failed with the buffered input TS2322 mismatch; c406691e8 fixes
it with admitted owned byte storage and a failing ownership regression test.
639 focused ZIP/unzip tests and scoped lint pass. Automatic large-byte ZIP64,
line conversion, move/timestamps, streaming and other format/grammar areas stay open.

## Comment selection independent of payload dates

Native Unix Zip and public zip.c's comadd mark=2 path establish that source date
exclusions do not remove existing members from comment selection. Existing
directory members also retain comment selection under D. Five initially failing
memory cases establish the mismatch: from/before/empty date ranges, continued
include/exclude priority and existing directories. Separated name/comment
selection from payload dates and directory omission without reading skipped
payloads. Stdin members receive the same existing-comment selection treatment.
644 focused ZIP/unzip tests and scoped lint pass. Native captures remain manual;
unit tests use memory filesystems. Remaining formats, streaming, line conversion,
move/timestamps and grammar requirements are still open.

## Latest-member archive timestamps

Native Zip 3.0 finish/latest and Unix stamp establish o/latest-time uses the
newest non-directory member, rounds upward to DOS two-second boundaries and sets
both access and modification times. Timestamp-only operations retain archive
bytes; unchanged update/freshen keeps status 12 while applying time. Added
cancellation-aware selection, original-byte retention and timestamp-bearing owned
staging, verified before publication. Initial eleven unsupported-option failures
validate the gap. Seventeen memory cases cover aliases, rounded/fractional times,
retained/deleted/copy-selected members, unchanged actions, staging options and
metadata rejection cleanup, stdout, directory-only warnings/time preservation,
pre-DOS/midnight boundaries and cancellation. Further failing cases validated
empty cancellation, missing access time and directory-only timestamp changes.
661 focused ZIP/unzip tests and scoped lint pass. Native UnZip integrity and
Python verify the actual generated binary archive; output access/modification
times match native odd-second capture at 1700000002. Artifacts are preserved in
/tmp/safe-bash-zip-latest-result.zip and /tmp/safe-bash-zip-latest-result.json.
Reference: https://github.com/LuaDist/zip/blob/master/zip.c and unix/unix.c
Comment-selection release 35018219722 failed on published-version collision
0.1.624. Remaining move, line conversion, streaming, formats and grammar stay open.

## Integrity checks on unchanged archives

Native Zip 3.0 and public zip.c finish/test paths validate standalone T,
unchanged update/freshen T and directory-only oT behavior. Seven initially
failing memory cases cover success status, retained bad CRCs and warning order.
Retain original bytes for test-only validation, defer timestamp warnings until
integrity succeeds and avoid publication when no archive changes are requested.
Native unmatched copy T tests the input without creating output; an additional
failing memory case validates that publication guard, with corrupt-input coverage.
670 focused ZIP/unzip tests and scoped lint pass. Timestamp scoped release
35019636709 succeeded; root release 35019637057 remains monitored. Full grammar,
move, line conversion, large-byte ZIP64, streaming and other formats remain open.

## Current file-sync test/timestamp combinations

Native Zip 3.0 skips T when FS is already current, including corrupt retained
payload CRCs; o still applies the latest-member timestamp. One failing memory
case validates the oT mismatch; paired T-only coverage protects the fast path.
Skip the test stage for unchanged file-sync while retaining timestamp publication.
672 focused ZIP/unzip tests and scoped lint pass. Integrity fix 744bc9a1b is
verified on remote main via a05c09903; release 35020582170 is monitored.
Remaining broad compliance requirements above remain open.

## LF-to-CRLF payload conversion

Native Zip 3.0 captures and public zipup.c file_read/util.c is_text_buf establish
l/to-crlf behavior, including CRCRLF expansion, control-only inputs and binary
classification. Measured first-input classification boundaries are 8192 bytes
for STORE and 32768 for DEFLATE in the Unix oracle. Thirty initially failing
memory cases validate unsupported l/long aliases and payload effects. Added
bounded cooperative conversion before compression with aggregate expansion
accounting, preserving symlinks and retained members. Captured LF/CRLF/CR,
Ctrl-Z, controls, NUL and UTF-8 payloads are checked for both methods; boundary,
stdin, growth rejection and cancellation cases supplement those captures.
705 focused ZIP/unzip tests and scoped lint pass. Native binary warning/progress
formatting, ll reverse conversion and compressor-profile read-size qualification
remain open, alongside the broader remaining requirements. References:
https://github.com/LuaDist/zip/blob/master/zipup.c and util.c
Native UnZip integrity and Python exact UTF-8/CRCRLF payload checks pass for
/tmp/safe-bash-zip-to-crlf-result.zip, generated by the virtual command.

## Reverse conversion read-boundary investigation

Native ll classification spans 16383 bytes for STORE and 65535 bytes for the
Unix non-zlib DEFLATE oracle. file_read strips CR and Ctrl-Z at individual read
ends, not just EOF. STORE repeats fixed reads; DEFLATE fill_window read sizes
vary with transformed output and matching/window progress. A whole-file CRLF
replacement would not reproduce those effects. Reverse conversion remains open
pending source-reader/compressor integration and profile qualification. Native
boundary probes and deflate.c/zipup.c source are preserved in /tmp/infozip-*.

## ZIP text attributes

Public trees.c set_file_type and native stored/deflated captures establish the
text attribute for printable, UTF-8 and newline data; explicit STORE stays binary.
A one-byte DEFLATE attempt falling back to storage still retains its text hint.
Four initially failing memory captures validate the missing metadata. Classify
payload bytes during existing cooperative CRC traversal, using blacklisted and
white/gray control ranges, and set the hint for DEFLATE attempts only. Fourteen
capture cases and an all-256-byte test cover control-only input, tolerated controls,
NUL, rare binary, UTF-8, empty and fallback. 720 focused ZIP/unzip tests and scoped
lint pass. The implementation classifies the complete payload; native compressor
first-block hint variation remains a qualification item for large mixed inputs.
https://github.com/LuaDist/zip/blob/master/trees.c
Native UnZip integrity and Python text/fallback hints plus exact UTF-8 payload
checks pass for /tmp/safe-bash-zip-text-attributes.zip.

## Archive-name source operand fallback

Native Unix Zip does not glob quoted operands against new sources; an existing
literal wildcard filename takes precedence. Missing operands match existing
archive names and reread those sources. Captures validate cross-directory stars,
nw/ws, MM, update/freshen and junk-path preservation. Seven initially failing
memory cases reproduce missing rereads; a further failing directory case proves
r must not discover new children through archive fallback. Reuse the bounded
Selection grammar, preserve stored names and source inspections, and disable
recursive discovery for fallback matches. Tests also cover excluded payload reads,
new-archive nonexpansion and literal wildcard precedence. 731 focused ZIP/unzip
tests and scoped lint pass. Reverse conversion, move, streaming, formats and the
remaining grammar/metadata requirements stay open. Text-attribute delivery
ac4598dcf is verified on remote main; its publication remains monitored.
Native UnZip and Python verify exact updated payload and preserved stored paths
in /tmp/safe-bash-zip-archive-source-patterns.zip. Conversion scoped release
35021106947 failed at SafeFS publication on version 0.1.627 collision; build
checks succeeded. Text-attribute scoped release 35021462848 remains live.

## Junk-path source fallback normalization

Public Unix procname/ex2in and native captures establish that j strips the
missing operand's path before archive-name matching. Matched source reads still
use stored names. Three failing memory cases validate wildcard/exact basename
rereads and strict rejection when only the unstripped archive path exists.
Normalize the fallback pattern, keep stored-name inspections, remove the obsolete
must-match-only matcher and distinguish absent matched sources from unmatched
operands. 734 focused ZIP/unzip tests and scoped lint pass. Remaining major
operations, reverse conversion, source streaming, formats and grammar remain open.
Move requires conditional deletion of source entries after publication; current
removeFileConditional only supports regular files, so symlink/directory ownership
needs contract work before full move support. No unchecked destructive fallback
was introduced. Live scoped/root releases remain monitored separately.

## Conditional source removal prerequisite for move

Move must remove only successfully archived source entries after publication,
without following a replacement symlink or adopting a replacement directory.
Added an independent atomicEntryRemoval capability and removeEntryConditional
operation checking parent identity and final-entry identity/type/revision. Memory
supports regular files, symlinks and empty directories without recursive deletion;
scope, mount and device views enforce capability, lifetime and mutation admission.
Read-only and quota views hide the new operation. Existing conditional file APIs
and retained cleanup remain unchanged. Initial failing memory/scope/device cases
validate absent support; corrected the mount fixture constructor before checking
that view. Thirty-seven memory cases cover exact types, replacements, stale/unknown
snapshots, nonempty directories, cancellation/budget refusal, hardlinks, protected
paths, capability denial and restricted views. Sixty-two focused filesystem tests,
workspace typecheck and scoped lint pass. Full maintained unit verification is
required before pushing this shared-contract change. ZIP m integration remains
open alongside the other major requirements. Scoped release 35022183021 succeeded.

## Move source lifecycle integration

Native Zip 3.0 finish/trash and zipfile.c validate m/move, unchanged update/freshen
source deletion with status 12, current FS deletion, stdout completion and symlink
pathname removal. Stored directory removal follows file deletion; Unix D capture
retains the omitted source directory. Fourteen initial unsupported-option failures
validate missing support. Record scoped parent/final-entry snapshots before reads,
require atomic conditional removal, and remove only after successful publication
or stream completion. Native unsuccessful unlink warnings retain successful status;
replaced sources survive. Advance related directory/hardlink snapshots only when
identity and exact next revision match owned deletions, using an identity index.
Sixteen memory cases cover aliases, source types, filters, native unchanged status,
publication/integrity/stdout failures, replacements, hardlinks and missing capability.
750 focused ZIP/unzip tests and scoped lint pass. These tests use current source
MemoryFileSystem because the root's bundled SafeFS export has not yet been rebuilt.
Full shared-contract verification 41257 reported missing poe-code/safe-fs/core
because packages/safe-js/dist/safe-fs-core.js was absent. A native process sample
confirmed CPU/memory-heavy error serialization; stopped that failed child and
completed maintained npm run build. Full tests and lint are rerunning as session
9534; do not push until the required checks pass. No release is claimed for
local contract 2a3f1823d or the pending move integration. Broader scope stays open.

## Move permission, cancellation and foreign-mutation evidence

Native locked-parent captures establish removal refusal retains status 0 and
quiet suppresses the warning. Four further memory tests validate quiet/nonquiet
permission refusal, cancellation immediately after publication and foreign
hardlink mutation during owned-snapshot refresh. 754 focused ZIP/unzip tests and
scoped lint pass. Inspected /tmp/zip-move-cli.png from the maintained screenshot
renderer: command progress, error-deleting warning and native successful status
are readable. Normal maintained workspace/root build succeeded in the isolated
checkout. A production poe-code/safe-fs/core invocation archived a binary file and
stored symlink with rmTy, then removed the source tree. Native UnZip integrity and
Python exact members/payload/mode checks pass for /tmp/safe-bash-zip-move-result.zip.
Full unit verification and lint remain live in session 9534. Contract and move
commits remain local until those checks pass; no new remote delivery is claimed.

## Paths compatibility option

Native Unix Zip 3.0 and public zip.c case p validate that -p/--paths is
an intentional compatibility no-op, including before or after -j. Nine memory
filesystem tests cover short/long/repeated options, grouped jp/pj, ZIPOPT plus
explicit junk paths, negation and invalid values. Six valid cases failed before
the parser change; all 763 focused ZIP/unzip tests and scoped ESLint now pass.
The full workspace check in delivery session 9534 remains live; this option
and the move follow-up have not yet been delivered to remote main.

## BZIP2 stream boundary prerequisite

Current source already contains a bounded generated libbzip2 codec; no new
runtime dependency is needed to reuse it. Its default concatenated-member
decoding consumes bytes ZIP needs to inspect as trailing compressed data. Six
failing fake-codec cases reproduce this for same-chunk and next-chunk input
across bzip2/xz/zstd. Added optional singleMember decoding to restore unread
bytes without pulling the next frame or stripping XZ padding. Three independent
Python BZIP2 fixture cases verify real decoding with 1/7/65536-byte chunks and
exact trailing-byte preservation. All 31 bounded-codec tests pass. This is a
prerequisite; ZIP method 12 parsing, headers, encoding and decoding remain open.

## BZIP2 method integration in progress

Eleven failing ZIP tests reproduced method rejection, independent Python input
rejection and missing method-12 wire support. Reused existing boundedCodec with
singleMember; no dependency or lockfile edit. Added method selection, bounded
encoding/decoding, STORE fallback and extraction version 46 even for ZIP64.
Twenty-three method tests now cover level/method abbreviations, descriptors/T,
ZIP64, Python binary fixture, copy preservation, trailing/concatenated streams,
truncation, checksum damage, invalid versions and DEFLATE-only header flags.
The corrected header tests reproduced three flag-admission failures before the
fix. All 785 focused ZIP/unzip cases and scoped ESLint pass. Python verifies
method 12/version 46/exact binary data in /tmp/safe-bash-zip-bzip2-result.zip;
Apple UnZip skips it because it supports extraction only through version 45,
so native validation is not claimed. Workspace typecheck:all is running in
session 31252 after the nonbuilding route correctly refused missing inputs.
Full workspace session 9534 is still active but reported an agent-harness
callable-parity rejected-result 5000ms timeout. No new remote delivery yet.

The build-first typecheck terminated with stale safe-fs declarations missing
removeEntryConditional in the root checkout. This does not validate production
types. Started the maintained virtual-bash workspace build closure and then
nonbuilding typecheck to rebuild the actual safe-fs dependency first.

Workspace closure build and subsequent production tsc passed, resolving the
safe-fs contract declarations. Consumer typecheck still requires a browser
artifact produced by the root bundle suffix, so consumer validation remains
unproven until the normal build runs in the delivery checkout. Full session
9534 terminated: 2265 passed files, one callable-parity timeout, two skipped
files; the exact callable-parity file rerun passed all 21 cases in 2.65s. A
full maintained rerun is required, rather than treating that rerun as the gate.

## BZIP2 progress diagnostic

Inspected the maintained CLI screenshot and found method 12 was reported as
stored 0% despite valid compression. Added a failing memory test for exact
method/savings and matched public zipup.c bzipped wording. All 786 focused
ZIP/unzip tests pass. Inspected /tmp/zip-bzip2-cli-fixed.png: bzipped 97%,
integrity OK, exit 0. Delivery checkout ff2b7d4c0 is running normal build,
consumer typecheck, full unit and lint in session 18440; this diagnostic
follow-up is not yet included in that checkout or remote main.

## BZIP2 streamed input and selection combinations

Nine additional memory cases validate empty/binary/compressible stdin to stdout
with method 12, signed descriptors and actual ZIP64 wire size markers, plus
explicit method switching, suffix STORE selection, level-9 suffix override and
level-zero suffix-selected STORE. The reader intentionally resolves ZIP64
without retaining the writer-only zip64 boolean; tests inspect headers rather
than adding unnecessary metadata. All 795 focused ZIP/unzip cases pass.
Python independently decoded exact 400000-byte level-1 multiblock output from
/tmp/safe-bash-zip-bzip2-multiblock.zip. Normal delivery build passed; consumer
typecheck historical models remain live in session 18440, followed by full
unit and lint. The new test-only follow-up is not in that running checkout.

Scoped edge-test ESLint passed. Delivery session 18440 terminated at the
historical source-model subprocess timeout (180000ms); it reported no
TypeScript diagnostic and never started full unit or lint. Rechecking that
exact maintained historical-model route separately in session 86237; full
delivery gates remain unproven.

## Historical typecheck ZIP64 test correction

Separate historical-model session 86237 terminated with TS2532 at
zip-format.test.ts:568: indexed Buffer mutation was possibly undefined under
noUncheckedIndexedAccess. Corrected the known allocated-byte access without
changing the corruption scenario. All 132 format tests pass; source/test
historical type verification must be repeated after integrating this correction.

## Basic help argument behavior

Native Unix Zip captures validate h/help/hel, quiet groups, immediate success
before later unsupported arguments, earlier argument errors, negation/value
rejection and literal termination. Eight new success cases failed before the
change. Added basic usage as a parser information result; no filesystem access
is needed. Fourteen memory tests include denied filesystem methods and ZIPOPT
ordering. All 809 focused ZIP/unzip tests, scoped ESLint and virtual-bash
production build closure pass. Inspected /tmp/zip-help-cli.png for aligned,
readable usage and supported options. Extended help, version, license and
show-options behavior remain separate open requirements.

## Extended help argument behavior

Native Unix Zip captures validate h2/more-help/more, quiet groups, h22 immediate
exit, later invalid arguments ignored and negation/value rejection. Seven
success cases initially failed; eleven denied-filesystem/status tests now pass.
Added extended guidance using existing implemented behavior, without copying
native license or version claims. All 820 focused ZIP/unzip tests, scoped
ESLint and virtual-bash production build closure pass. Inspected
/tmp/zip-more-help-cli.png: readable complete output and aligned sections.
Delivery session 46504 remains live on the prior basic-help main checkout.
Remote main advanced to 71837fa14110e3c17aa3a99f32a23059a6363afb; integrate it
after the live gate before verifying final delivery. No new push in this turn.

## Traditional encryption byte-stream prerequisite

PKWARE APPNOTE 6.1 specifies per-member key initialization, raw CRC register
updates, modulo-32-bit multiplication and plaintext-driven updates. Native Zip
-0 -P captures with test/tiger/UTF-8 passwords were independently extracted and
verified by Python zipfile; fixtures include their decrypted 12-byte headers.
Added a bounded cooperative ZipCrypto transform with per-stream keys, input
retirement and output ownership. Twenty-eight memory tests cover native
encryption/decryption vectors, 1/7/65536-byte input chunks, interleaving,
backpressure, cancellation, pre-abort, retirement and source failure. A native
150000-byte ciphertext SHA256 verifies 65535/65536/65537/150012-byte input
boundaries independently. Shared the existing ZIP CRC table instead of
duplicating it. All 848 focused ZIP/unzip tests pass after this extraction;
scoped lint and the final production closure build pass. No runtime
dependency added. This does not yet enable encrypted ZIP commands: password
arguments, 12-byte header checks, encrypted STORE size accounting, descriptor
check bytes, secure header generation and copy/update behavior remain open.
Delivery session 46504 has passed source and 26 consumer typecheck groups and
is still executing the full maintained unit gate on its earlier checkout.

## Release gate readonly capability correction

Full maintained unit gate passed the shared workspaces but rejected one readonly
capability expected object missing atomicEntryRemoval: false. The adapter
correctly disables the new move prerequisite; updated the explicit conservative
expected list. Final main integrates remote 4f6988bed and all ZIP local commits;
full verification and GitHub publication remain required before delivery claims.

## Integrated release native pipe transport correction

Initial delivery ee3ffc295 passed normal build, full npm test and full repository
lint. Main advanced to 4e2e26229; merged its shared filesystem and distribution
work in 405a12083, preserving both API additions. Its integrated build passed;
the subsequent unit run was intentionally stopped (exit 143) to correct concrete
remote CI blockers, and is not a passing full gate. Remote native trap probes
failed with /dev/stdin ENXIO because Linux cannot reopen spawnSync stdin sockets.
Four new memory host tests reproduce the missing pipe transport and input bound
before correction. The authenticated Bash now supplies input through a real
process-substitution pipe, passing the original script unchanged. Octal UTF-8
encoding preserves NUL, Unicode, quotes, slashes and final-newline bytes; a 16KiB
input bound prevents exceeding the per-argument transport limit. Authentication,
clean environment, native deadlines and output caps remain active. This changes
only native qualification tooling, not product execution or a host fallback.

## Native short-consumer pipe correction

Remote CI's native yes short-consumer probe expected SIGPIPE after destroying a
Node stdout socket. Socket peer closure does not qualify anonymous-pipe closure;
Linux reported a null process signal. Replaced only this probe's transport with
an actual Bash pipeline and one-line consumer. The wrapper checks consumer
status zero and returns the captured producer PIPESTATUS, which must be 141;
exact y-newline output and empty stderr remain asserted. Both system and pinned
GNU probes keep these checks, without admitting arbitrary exit-one outcomes.
The native oracle remains bounded and drained; no product command is changed.

## Native timed-read qualification profiles

Linux CI's authenticated Bash 5.2.37 reports different exact bytes for an
end-requested stdin socket zero-poll and two timeout escape projections. The
gate-delimiter fixture requests closure without first observing EOF; Bash's
input_avail uses OS readiness, so this is socket/build evidence, not previously
observed pipe EOF. Renamed that case and retain separate exact Darwin/Linux
captures including unchanged variable and subsequent EOF checks. Bash read.def
has nonvolatile saw_escape (line 207), modified after setjmp (488), then consulted
for dequoting after timeout longjmp (1030): compiler/build differences are not
grounds to change product input. The two native Linux hex captures remain exact;
the existing virtual SOH representation asserts stay unchanged and separate.
Standalone escape, continuation and incomplete UTF-8 expectations remain exact
in both profiles. This deliberately ceases to claim native byte equality for
these two virtual projections; no blanket normalization or production change.
