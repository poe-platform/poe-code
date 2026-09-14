# DOCX file publication boundary

The package exports `publishDocumentArchive` and `publishDocumentFiles` as async
publication infrastructure. They use the supplied portable safe-fs contract;
there is no filesystem, stdout, clock, identity or network authority by default.
The complete public model and commands remain planned. This does not promote
any model row in the API inventory to implemented.

`PublicationOptions` uses the shared camelCase operation spellings: `output`,
`inPlace`, `force`, `dryRun`, and `json`. `creation` identifies a creation
invocation. Flags must be booleans; unknown options and accessor properties fail.
Invocation options and input snapshots are owned before asynchronous work. A file input carries its absolute VFS path and original admitted
`FileStat` snapshot. Stream inputs omit this file identity; they cannot use
in-place. Paths are normalized absolute VFS paths resolved by the caller.

Publishing requires exactly one output or in-place intent; creation requires
output. Dry-run permits no output and validates any proposed destination, including
stale in-place snapshots. Binary output uses `output: "-"` and a supplied stdout
sink. JSON conflicts with binary publication, but works with dry-run. No progress
or textual result is written into that sink. Force requires an explicit output;
it never grants alias replacement, weaker validation or additional capabilities.

The engine owns serialization before awaited destination queries. XML/package
validation and bounded serialization finish before any final file or stdout
publication. Present document/write-protection and control-lock markers, signature
content types, signature XML and signature relationships conservatively refuse
publication, even under force. Feature-specific authorized edits/removal remain
later work; a disabled protection marker can also be refused by this early boundary.
Callers must retain protection/authorization checks when constructing edits; this
boundary cannot reconstruct source structures a caller removed before invocation.

Per-path `capabilitiesFor` overrides global capabilities. Atomic staging needs all
three methods and an affirmative capability. Parent identity and destination
identity/revision snapshots must be available. Existing file outputs need force;
input aliases require in-place. Existing output identity is compared through the
adapter's `compareEntry`; unknown identity refuses. A genuinely absent final entry
is published with the atomic absence condition, so a raced alias/file cannot be
overwritten. Symlink final destinations and non-directory parents are refused.

In-place publication uses the original admitted snapshot, checked in preflight
and again by atomic publication. `createStagedFile` acquires an exclusive private
stage beside the destination. Its receipt establishes cleanup ownership.
`publishStagedFile` checks staging, parent and destination conditions atomically.
There is no unconditional write, delete-then-write, or exists-then-write fallback.
A staging-name collision fails safely; no colliding path is adopted or removed.
`removeStagedFile` is awaited without the cancelled signal. Cleanup never guesses
ownership, deletes a published destination, or recursively removes user directories.

`publishDocumentFiles` receives already selected extraction byte arrays and final
paths. It owns and bounds all bytes and preflights all destinations before
publication. The current VFS has no multi-file transaction contract; multiple
files require explicit `allowPartialOutput` (the later command's
`--allow-partial-output`). Existing directories are required. Directory creation,
package inventories, part hashes and command envelopes belong to the later
extraction task. This boundary reports the exact completed path/byte-count list;
that list supplies published state to the eventual richer `ExtractionData`.

Success returns `published`. `PublicationError` exposes a stable code, cause,
completed `published` files and `stdoutMayBePartial`. A failed stdout transport
cannot report an exact accepted byte count, so it explicitly marks possible partial
stdout. A completed commit is not undone or hidden by cancellation arriving after
its receipt. Extraction and cleanup failures retain completed-file manifests.
Input/semantic/resource failures before publication retain their existing neutral
error categories. Publication cancellation remains a `CancellationError` with code `cancelled`
and additional completed-file/partial-stdout evidence.

The publication engine is shared infrastructure for the future CLI and SDK save
routes, not an independent document editor. Existing neutral model snake_case
names, enum/protocol mappings, XML security mappings and 1,337 proposed API-map
rows are unchanged. Async VFS/stream authority, owned Uint8Array data and camelCase
operation options follow the shared SDK contract. Whole-public-API coverage,
command discovery and JSON/exit envelopes remain later pipeline work.

Evidence: [owned execution record](../plans/docx-safe-file-publication.md).
