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
