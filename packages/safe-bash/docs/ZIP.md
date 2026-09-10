# ZIP commands

The default agent preset and `archiveCommands()` register `zip` and `unzip`
alongside `tar`. `createZipCommand()` and `createUnzipCommand()` expose the same
commands independently. Source availability does not imply an already published
package version.

```sh
zip -r project.zip project
unzip -l project.zip
unzip -o -d extracted project.zip 'project/*.txt'
```

`zip [-r] ARCHIVE FILES...` creates an archive or updates selected entries while
retaining other members. An archive basename without a dot gains `.zip`.
`unzip [-l] [-o] [-d DIR] ARCHIVE [FILES...]` lists or extracts selected members;
selection patterns are matched inside the archive. Existing regular files prompt
on stdin unless `-o` is supplied. EOF declines remaining replacements with warning
status. Commands use only the supplied virtual filesystem: no native executable,
implicit filesystem access or network fallback.

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
| `maxTextBytes` | 1048576 | Progress, listing and comment bytes |
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
