# ZIP commands

The default agent preset and `archiveCommands()` register `zip` and `unzip`
alongside `tar`. `createZipCommand()` and `createUnzipCommand()` expose the same
commands independently. Source availability does not imply an already published
package version.

```sh
zip -r project.zip project
zip -qr project.zip project
unzip -l project.zip
unzip -o -d extracted project.zip 'project/*.txt'
unzip -p project.zip 'project/*.txt' | cat
```

`zip [-r] [-q] [-j] [-D] [-y] [-T] [-@] [-0..-9] ARCHIVE FILES... [-i PATTERNS...] [-x PATTERNS...]`
creates an archive or updates selected entries while
retaining other members. An archive basename without a dot gains `.zip`.
`unzip [-l] [-p] [-o] [-d DIR] ARCHIVE [FILES...]` lists, streams or extracts selected members;
selection patterns are matched inside the archive. Existing regular files prompt
on stdin unless `-o` is supplied. EOF declines remaining replacements with warning
status. Commands use only the supplied virtual filesystem: no native executable,
implicit filesystem access or network fallback.

## Quiet creation and byte streaming

`-0` stores files without compression; `-1` through `-9` select DEFLATE effort,
from fastest to maximum compression. The default is `-6`. The last level controls
compression effort, including flags after operands and grouped flags such as
`-q9r`. Selecting `-0` switches to storage mode; a later positive level does not
switch the method back to DEFLATE. Files that do
not compress smaller remain stored. Compression levels do not promise identical
archive bytes to Info-ZIP.

`-n SUFFIX:SUFFIX...` stores matching filename suffixes without compression.
Unix suffix matching is case-sensitive. Defaults are `.Z`, `.zip`, `.zoo`, `.arc`,
`.lzh` and `.arj`; an empty value retains defaults, while `:` clears the list.
Attached and equals values such as `-n.txt` and `-n=.txt` are accepted. `-9`
overrides the suffix list and attempts maximum compression.

`-Z store` / `-Z deflate` and `--compression-method=METHOD` explicitly select the
method. Method names are case-insensitive and accept unique prefixes. Store mode
remains selected through later level flags; `-Z deflate` switches it back. The
native invalid level-zero/DEFLATE combination returns status 5 when compressing a
nonempty regular file. Unknown methods return 16. Bzip2 is currently not enabled
and returns the native disabled-method status 19; reading and writing method-12
archives remains format implementation work.

`-@` reads one source filename per stdin line before processing command-line
operands. Empty lines are ignored; trailing carriage returns are removed, while
spaces, tabs and leading dashes are preserved. An unterminated final line is
accepted. Repeated `-@` flags consume stdin once. Filename input is bounded by
`maxFilesFromBytes`, with the usual combined operand, path and work limits.
The input stream is owned and drained before cancellation settlement.

`zip ARCHIVE -` stores stdin's binary payload as member `-`. Repeated stdin
operands consume it once; excluded stdin members do not acquire the input iterator.
Filename-list input and payload input share one owned iterator, so a completed
`-@` list leaves EOF for any subsequent payload. Payload input is bounded by
`maxEntryBytes` and the remaining aggregate payload budget. Pipe-mode Unix
metadata is preserved; extraction creates a regular file with the payload and
permission bits, matching native UnZip rather than creating a FIFO. Invocation
cancellation drains admitted input reads before settlement.

`zip - FILES...` writes archive bytes to stdout and progress, warnings and fatal
diagnostics to stderr. It performs no archive file publication or staging and
uses stdout accounting and owned-output cleanup. With no archive argument,
`zip` (or `zip -q`) reads a stdin payload and writes its archive to stdout.
An explicit `zip -` with no file operands returns `Nothing to do!` and status 12.
Stream archives use signed data descriptors; default DEFLATE is retained even
when it expands a small or empty file. Storage mode remains available with `-0`
or `-Z store`. `-T` is ignored with a nonquiet advisory warning on stdout archives.
Archive update/freshen/delete actions on stdout are rejected with status 16.
Sources are selected and compressed before stdout begins. Archive serialization
then emits bounded records and payload chunks, waiting for each stdout write;
it does not allocate a second complete archive buffer for stdout. Complete
metadata admission precedes the first archive chunk. Source collection and
compression still retain member payloads; end-to-end input streaming remains
implementation work. Stdin members use ZIP64 records by
default. `-fz` / `--force-zip64` forces ZIP64 for every member; `-fz-` /
`--force-zip64-` disables forced/default stdin ZIP64. Repeated switches use the
last value. Both file and stdout ZIP64 output include valid end records and
locators; stdout uses signed 64-bit descriptors for ZIP64 members.

`-u` updates existing members only when the source has a newer whole-second
modification time, and adds new members. `-f` freshens only existing newer members.
With no file operands, these modes select existing archive paths. Unchanged source
payloads are not read or recompressed. If nothing changes, status 12 is returned
without the fatal `Nothing to do!` diagnostic or archive publication. Freshening
does not create a missing archive. Different action flags (`-u`, `-f`, `-d`) cannot
be combined; repeated instances of the same action are accepted.

`-FS` / `--filesync` makes the archive match the selected source set: members
outside that set are deleted, new files are added, and existing members are
replaced when their DOS two-second modification time or size differs, including
older source files. Current payloads are copied without reading source data.
An entirely current archive returns 0 without publication and prints `Archive is
current` unless quiet. Empty source selection returns 12 and preserves the archive.
Filesync cannot be combined with update, freshen, delete or copy actions. Separate
output, recursion, filters and omitted directory entries apply to synchronization.

`-z` / `--archive-comment` reads a replacement archive comment from stdin after
member input. Input lines join with CRLF, a line containing exactly `.` and LF
terminates input, and EOF also completes it. CR bytes and non-UTF8 bytes remain
literal; NUL truncates each input line as in native Unix Zip. Quiet suppresses
the old-comment display and input prompt. Comment-only updates require a nonempty
existing archive. Delete and copy ignore this flag; current filesync returns
without editing comments. Input and resulting comments are bounded by
`maxFilesFromBytes`, `maxPatternSteps`, `maxTextBytes` and the 65,535-byte format
limit. Overflow rejects publication rather than truncating the comment.

`-c` / `--entry-comments` reads one comment line for each selected member in
archive order after file processing. Trailing LF is removed, CR remains literal,
and NUL truncates the line. A blank line clears a member comment; EOF preserves
its previous comment. Update/freshen can comment unchanged members without
reading their payloads. Prompts are suppressed by quiet; delete/copy ignore the
flag, and wholly current filesync skips commenting. Entry comments and `-z`
share one bounded stdin cursor. Comment lines split at 65,535 bytes like native
`fgets`. Changed Unicode-comment extras are removed to avoid stale CRCs. Raw
non-UTF8 comments clear the UTF-8 flag; required Unicode-path metadata preserves
Unicode filenames when that flag is cleared.
Source date exclusions apply to payload replacement, while selected existing
members can still receive comments. Include/exclude name filters continue to
apply. `-D` omits new directory entries without preventing comments on existing
directory members.

`-o` / `--latest-time` sets archive access and modification times to the newest
non-directory member's DOS two-second time. Odd seconds round upward and pre-1980
times clamp to the DOS minimum. Retained members participate; directory-only
archives warn unless quiet and keep their existing timestamp when unchanged.
Timestamp-only operations preserve archive bytes. Unchanged update/freshen keeps
status 12 while applying archive time. Stdout ignores this option; separate output
uses the selected output members. Both times are supplied to owned staging and
verified before publication, so rejected metadata leaves the destination intact.

`zip -d ARCHIVE PATTERNS...` deletes matching archive members without looking for
their source files. Inclusion and exclusion lists apply to those archive paths.
Unmatched operand patterns warn unless quiet; no selected members returns status
12 without replacing the archive. Retained payloads, metadata and the archive
comment are preserved. Deleting all members produces an empty ZIP, while combining
that operation with `-T` rejects the empty candidate and preserves the original.
`-r` is ignored with a nonquiet advisory warning in delete mode; `-j` does not
rename existing archive paths.

`zip -j` stores files by basename, discarding their directory paths and omitting
directory entries. Combine it with `-r` to flatten a directory tree or `-q` for
quiet output. Distinct sources with the same basename return status 16 without
publishing changes to the archive.

`-D` omits newly selected directory entries while still traversing directories
with `-r`. Existing directory members remain in an updated archive. Selecting
only a directory without recursion produces `Nothing to do!` and status 12.

`-y` stores symbolic links as their target bytes with Unix symlink metadata,
including broken links and links to directories. It does not traverse link
targets, so recursive cycles through links are preserved as links. Without `-y`,
sources are dereferenced. Link reads require the filesystem's `readlink` operation
and are checked for source replacement before publication. Storing an escaping
target does not authorize its extraction; extraction path checks remain enabled.

`-l` / `--to-crlf` expands LF bytes to CRLF in newly selected regular-file and
stdin payloads. Existing CRLF becomes CRCRLF; stored symlink targets and retained
members remain unchanged. The Unix first-buffer binary check uses 8 KiB for
stored sources and 32 KiB for deflated sources. Blacklisted control bytes disable
conversion; control-only input is also left unchanged. Conversion expansion is
charged against entry and aggregate payload limits before allocating output.
Native binary warning/progress formatting and reverse conversion (`-ll`) remain
unimplemented.

`-T` rereads the prepared archive and verifies every member's decompression,
length and CRC before publication, including retained old members. It does not
extract files or invoke a host executable. Standalone and unchanged update/freshen
tests succeed without rewriting the archive. An unmatched copy tests the input
without creating a separate output. Directory-only timestamp warnings follow a
successful test; a failed test preserves the archive and its timestamps. An
already-current `-FS` skips integrity testing, including when applying `-o`. Invalid payloads and an empty result
return status 8 without publishing the update. Successful nonquiet tests print
`test of ARCHIVE OK`; `-q` suppresses this message. Decoded bytes are discarded
under the archive limits rather than written or charged as stdout. Corruption
uses the native ZIP failure status and final diagnostic; embedded UnZip diagnostic
text and temporary filenames are not reproduced by this implementation.

`-i` includes matching source paths and `-x` excludes them. Patterns support `*`,
`?`, bracket classes and backslash escapes; `*` can span directories. Quote
patterns to prevent shell expansion, for example
`zip -qr project.zip project -x '*/node_modules/*' '*/.git/*'`.
Exclusion takes precedence over inclusion. Filters use source member paths before
`-j` removes directories and do not prevent traversal into unmatched directories.
Pattern lists end at the next option or a standalone `@`; attached patterns such
as `-x'*.tmp'` or `-x='*.tmp'` consume only that attached value. Existing unselected
archive members remain intact.
An unmatched inclusion list produces an empty archive with status 0; exclusion-only
selection with nothing to add returns status 12.

Native long spellings are accepted for the implemented flags, including
`--quiet`, `--recurse-paths`, `--junk-paths`, `--no-dir-entries`, `--symlinks`,
`--test`, `--names-stdin`, `--update`, `--freshen`, `--delete`, `--store`,
`--compress-1` through `--compress-9`, `--include`, `--exclude` and `--suffixes`.
Value options accept `--include=PATTERN` and `--suffixes=LIST`; an empty attached
include is a valid nonmatching pattern. Unique long abbreviations are accepted,
with all native Unix option names considered for ambiguity. Long-looking paths
after `--` remain literal. Additional native options still require implementation.

`zip -q` suppresses adding/updating progress and the advisory warnings that native
Info-ZIP suppresses in quiet mode, including missing-source and repeated-name
warnings. Fatal diagnostics and exit statuses remain: for example, no matching
sources returns 12 and repeated archive member names return 16. Thus a missing
source alongside a valid source can succeed silently, while no matching sources
still produces the fatal `Nothing to do!` diagnostic. Grouped `-qr`/`-rq`, repeated
`-q`, and `-q` after operands are supported. Suppressed messages do not consume the
text-output budget. Archive file output remains charged and publication uses the
same owned staging and replacement checks as non-quiet creation.

`unzip -p` concatenates selected members' raw bytes in archive order on stdout,
without an archive heading, comments, extraction progress or separators. Binary
bytes and symlink-target bytes are not decoded as text; empty members contribute
no bytes. It does not read overwrite answers, create destination directories,
stage files, publish entries or require filesystem write/metadata capabilities.
Only archive reads and their bounded fallback are needed.

`-p` takes precedence over `-l` regardless of order, and `-o` has no effect on
streaming. `-d DIR` is ignored with `caution:  not extracting; -d ignored` on stderr,
including when the archive is missing; the destination is not accessed. Selection
uses the existing archive glob matcher. As in Info-ZIP, streaming credits the first
matching pattern for each member, so a later redundant pattern can remain unmatched.
Unmatched patterns produce cautions and status 11, even after other selected bytes
were written. A missing archive returns 9 silently in `-p` mode; an empty archive
returns 1 with a warning.

CRC, length, compression and resource validation remain enabled. Streaming cannot
retract bytes already delivered before a final CRC/length failure; these failures
return 2 with a diagnostic. Other unsupported-format and resource-policy failures
retain the bounded implementation's existing status 2, not every native diagnostic
or native format-specific exit code. Advertised limits still cover the entire
archive, including unselected entries, while only selected payloads are decoded.
Existing member-path and metadata admission remains in force, even without
extraction. Raw output uses the shell stdout budget rather than the progress-text
or filesystem-output budget; comment metadata remains bounded even when hidden.
Writes honor backpressure and cancellation, including draining enrolled cooperative
stdout writes before cleanup completes.

## Configuration

Both factories accept `ArchiveCommandsOptions`. The preset accepts the same
options under `archive`. `replace` permits replacing existing command names in
the archive plugin; registration otherwise checks collisions before mutation.
`limits` overrides positive safe-integer bounds:

| Option | Default | ZIP use |
| --- | ---: | --- |
| `maxArchiveBytes` | 268435456 | Compressed archive bytes |
| `maxEntryBytes` | 67108864 | Advertised and actual member bytes |
| `maxTotalBytes` | 268435456 | Aggregate member bytes |
| `maxMembers` | 10000 | Entries, traversal and bounded retry work |
| `maxPathBytes` | 4096 | Member, filesystem and symlink-target names |
| `maxDepth` | 128 | Member/traversal depth |
| `maxPaxBytes` | 1048576 | Shared archive metadata bound; ZIP extra fields also have their format bound |
| `maxFilesFromBytes` | 1048576 | Stdin filename lists and overwrite-response input bytes |
| `maxArgumentBytes` | 65536 | Argument bytes |
| `maxTextBytes` | 1048576 | Progress, listing and comment bytes; not raw `-p` payload |
| `maxDiagnosticBytes` | 4096 | Error diagnostic bytes |
| `maxPatternSteps` | 10000000 | Selection and filesystem work |
| `maxBufferedFileBytes` | 1048576 | Fallback reads without streaming support |
| `chunkSize` | 65536 | Work chunks; accepted range 512–1048576 |

No new environment variables are introduced. DOS timestamps follow the runtime's
local timezone; extended Unix timestamps preserve absolute seconds. No host
process is invoked to implement shell-local timezone changes.

`-X` / `--strip-extra` omits optional metadata from newly added or rewritten
members. Untouched archive members retain their extras. Required ZIP64 size and
offset fields are still emitted. `-X-` / `--strip-extra-` preserves unknown extras
from rewritten members and regenerates their timestamps. Repeated switches use
the last value. Without extended timestamps, modification time is represented
at DOS two-second resolution.

`-fd` / `--force-descriptors` uses signed data descriptors for added or rewritten
files. Nonempty regular files retain DEFLATE even when compression expands
them; storage selection still applies. Empty files stay stored and directories
omit descriptors. The option is not negatable. Untouched members do not receive forced descriptors; existing descriptors
are normalized to ordinary file headers during archive updates. Forced ZIP64 descriptors use 64-bit
sizes and valid ZIP64 end records.

`-ws` / `--wild-stop-dirs` keeps single `*` and `?` within a directory;
`**` can cross directories. An explicit slash in a character class still
matches a slash. `-nw` / `--no-wild` treats stars, brackets and backslashes
literally; `?` retains wildcard behavior, matching the native Unix build.
These controls apply to include, exclude and archive-delete patterns and
are not negatable. Default UnZip pattern behavior is unchanged.

`-R` / `--recurse-patterns` scans the current directory recursively and treats
operands as selection patterns. Each pattern tests the same number of trailing
path components as it contains; explicit include patterns must also match and
exclusions take precedence. Hidden files participate. `-R` requires patterns
and cannot be combined with `-r`. Quoted filesystem globs without `-R` are
literal operands, matching native Unix Zip.

`ZIPOPT` supplies default arguments before command-line arguments. If it is
absent or contains only ASCII whitespace, `ZIP_OPTS` is used instead. The Unix
parser splits ASCII whitespace, supports double quotes only at the start of an
argument, and removes backslash escapes inside those quotes. Single quotes and
unquoted backslashes are literal. Command-line options follow these defaults
and retain normal precedence. Raw defaults and command arguments share the
argument byte budget; defaults are never evaluated as shell code.

`-t DATE` / `--from-date=DATE` selects modification dates at or after the
start date. `-tt DATE` / `--before-date=DATE` selects dates strictly before the
end date. Dates accept `yyyy-mm-dd` or `mmddyyyy` with native numeric-field
parsing, and comparisons use local DOS time rounded up to two seconds.
Repeated bounds use the last value. Date ranges apply to source selection and
archive deletion; an empty interval does not publish a new archive.

`-U` / `--copy-entries` copies selected archive members to the destination
set by `-O PATH` / `--output-file=PATH` (abbreviated `--out`). It preserves
compressed payloads without reading member source files. With no operands, all
members are considered; include, exclude, date and wildcard controls still
apply. `--out` alone with no operands selects copy mode. Separate-output updates
require an existing input archive and leave its bytes unchanged. Output and
input must differ, including backing identity; publication uses owned staging.
An archive argument of `-` continues to use stdout and ignores `--out`.

`-MM` / `--must-match` fails with status 18 when a requested filesystem name
cannot be found or read, preventing archive publication. Existing archive
members can satisfy missing filesystem names or patterns, including junk-path
matching under `-j`. Unmatched deletion operands are fatal; copy-mode pattern
misses retain status 12. Include/exclude/date filters do not require every
pattern to match. The option is not negatable.

## Supported format and safety

The bounded format profile supports ordinary single-disk ZIP records with stored
or raw-DEFLATE payloads, UTF-8/Unicode-extra and CP437 names, Unix timestamps and
modes, archive/member comments, classic and ZIP64 data descriptors, and bounded
single-disk ZIP64 input and output records. ZIP64 sizes and offsets must be safely representable
and within configured limits. The classic 65,535-member maximum is admitted;
archives with more members automatically emit ZIP64 directory/end records while
retaining classic member headers when sizes and offsets fit. Configured
`maxMembers` still applies. Large byte-size/offset automatic escalation remains
unimplemented; archive and entry byte admission retains classic-width caps.
Archive updates normally emit classic ZIP records and remove
obsolete ZIP64 size tags while preserving unrelated metadata. It rejects
encryption, unsupported compression methods, split archives, self-extracting
prefixes, unreferenced records and trailing bytes rather than guessing their
meaning. This is not an assertion of complete Info-ZIP compatibility or identical
compressed archive bytes.

Raw and effective names are checked before extraction. Absolute and parent
traversal members, symlink ancestors and escaping symlink targets are refused.
Local/central headers, spans, sizes and CRCs must agree. Actual decompressed
chunks are charged to the shell output budget before retention or publication,
including chunks preceding a final CRC/length error. Decoding uses bounded,
cooperative work, not arbitrary preemption or a process-memory sandbox.

Regular-file extraction stages validated data before replacing its destination.
Known backing identity is required where overwrite/alias checks depend on it.
Filesystems must faithfully implement the operations and capabilities they
advertise; pathname checks are not atomic leases against concurrent host changes.
Failures may leave earlier completed members or directories. ZIP progress-output
failure after archive publication can leave the completed archive written. There
is no whole-command rollback guarantee.

Owned staging cleanup can continue after cancellation through a restricted,
bounded retained-cleanup view. It does not bypass provider policy or filesystem
operation limits. If creation succeeds but ownership identity cannot be obtained,
or cleanup is refused by the provider or remaining operation budget, a temporary
entry can remain. Unknown or replaced entries are never deleted merely because
they occupy the expected temporary pathname.
