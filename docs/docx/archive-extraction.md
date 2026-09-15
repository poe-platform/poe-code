# Bounded archive extraction

`extractDocumentArchive(bytes, options, context)` backs the existing `extract`
command. The context supplies explicit archive limits, cancellation and VFS
capability. There is no ambient file access, network acquisition or native fallback.

Options use the shared CLI/SDK contract: `outputDir` / `--output-dir` is required,
`allowPartialOutput: true` / `--allow-partial-output` is required, `selection` /
`--selection` is `all` (default) or `media-only`, and `pretty` / `--pretty` defaults
false. The SDK destination is an absolute VFS path; the CLI resolves its destination
against its explicit cwd. Media selection means files/directories in `word/media/`;
it is separate from occurrence-based `images extract` and inert `objects extract`.
Generic batch and packing remain unsupported.

The entire admitted archive namespace is checked before selection/publication,
including excluded entries and explicit directories. Unsafe ZIP paths, duplicate
members and links reject during archive admission. Extraction additionally checks
file/directory conflicts, reserved manifest paths, decoded-path aliases, NFC and
conservative Unicode casing aliases (including expanding uppercase spellings).
Different spellings of implied parent directories also reject. Percent escapes
are never decoded into VFS output paths. Unknown or malformed package/XML content
remains subject to the existing document admission contract.

The destination must be a new tree under an existing canonical writable parent.
Preexisting files, directories, links and aliases reject even with force. Per-path
VFS capabilities must support explicit directories, writes, atomic directory
metadata and atomic file mutation, with `prepareDirectory` and
`writeFileConditional` methods. Directory creation uses expected null and a proven
parent identity; each file publication uses expected null and its owned parent.
Directories use mode 0700. Read-only mounts and missing guarantees refuse rather
than falling back to racy mkdir/write or recursive deletion. VFS adapters enforce
permissions and identity conditions atomically.

Default files retain exact source bytes and archive order. All selection retains
empty directories. Pretty XML uses the existing bounded display serializer,
preserving mixed character content and xml:space; selected XML and relationship
parts may have different display bytes. Binary media stays exact. `manifest.json`
is version 1, with document kind/dialect, selection, pretty intent, explicit relative
directories and file entries containing relative path, output byte count and
lowercase SHA-256. This does not declare a completed pack-input contract.

The readonly receipt contains outputDir, complete, possiblePartialOutput, entries
and manifestPublished. Each entry has relative path, output bytes, SHA-256 and a
confirmed published flag. Success completes the manifest last. Manifest and worst
case response/diagnostic serialization are admitted before any VFS mutation.
I/O, resource exhaustion or cancellation can leave a partial new tree. Published
flags describe fulfilled calls; a rejected call may still have created new output.
No tree or file is removed as cleanup. SDK failures after publication begins retain
this receipt in ArchiveExtractionError.data. The command also retains a typed
extraction receipt when final stdout fails.

## Exact language/security mappings

| Surface | JS/security mapping |
| --- | --- |
| Archive input | Async explicit Uint8Array admission; existing cumulative archive/XML/work budgets |
| Selection | Closed string union, all by default; full namespace validation precedes filtering |
| Output | Explicit VFS authority, absolute SDK path or explicit CLI cwd resolution; conditional absent-entry publication |
| Payload/hash | Exact owned admitted bytes by default; bounded pretty XML is display serialization; SHA-256 strings describe actual output |
| Manifest/receipt | JSON-compatible snapshots and readonly arrays/properties; no live package owner or dynamic member evaluation |
| I/O/abort | Awaited provider operations; no rollback promise; cancellation has code cancelled and retains partial receipts |
| CLI statuses | 0 success, 1 document/namespace/conflict refusal, 2 usage/schema, 3 I/O/publication, 4 limits; shell cancellation remains 130 |
| Model API | Neutral documented names retained; inherited APIs, enums, collections, helpers and public underscore-prefixed types keep their recorded obligations |

The [original regression file](../../packages/docx/src/extract.test.ts) uses small
original archives and memfs publication fixtures, plus actual memory/mounted VFS
contracts. It covers exact bytes, selection/pretty output, raw unsafe excluded ZIP
entries, links, duplicates, Unicode aliases, empty directories, preexisting/raced
collisions, permissions, read-only mounts, atomic-capability refusal, prepublication
receipt limits, partial I/O/abort, stdout failure and CLI/SDK discovery/status parity.
No downloaded fixture contributes to these unit tests. The pinned API inventory
and historical evidence remain unchanged; this bounded utility does not establish
whole-model or whole-format conformance.
