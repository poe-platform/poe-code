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

`zip [-r] [-q] ARCHIVE FILES...` creates an archive or updates selected entries while
retaining other members. An archive basename without a dot gains `.zip`.
`unzip [-l] [-p] [-o] [-d DIR] ARCHIVE [FILES...]` lists, streams or extracts selected members;
selection patterns are matched inside the archive. Existing regular files prompt
on stdin unless `-o` is supplied. EOF declines remaining replacements with warning
status. Commands use only the supplied virtual filesystem: no native executable,
implicit filesystem access or network fallback.

## Quiet creation and byte streaming

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
| `maxFilesFromBytes` | 1048576 | Overwrite-response input bytes |
| `maxArgumentBytes` | 65536 | Argument bytes |
| `maxTextBytes` | 1048576 | Progress, listing and comment bytes; not raw `-p` payload |
| `maxDiagnosticBytes` | 4096 | Error diagnostic bytes |
| `maxPatternSteps` | 10000000 | Selection and filesystem work |
| `maxBufferedFileBytes` | 1048576 | Fallback reads without streaming support |
| `chunkSize` | 65536 | Work chunks; accepted range 512–1048576 |

No new environment variables are introduced. DOS timestamps follow the runtime's
local timezone; extended Unix timestamps preserve absolute seconds. No host
process is invoked to implement shell-local timezone changes.

## Supported format and safety

The bounded format profile supports ordinary single-disk ZIP records with stored
or raw-DEFLATE payloads, UTF-8/Unicode-extra and CP437 names, Unix timestamps and
modes, archive/member comments, and ordinary data descriptors. It rejects ZIP64,
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
