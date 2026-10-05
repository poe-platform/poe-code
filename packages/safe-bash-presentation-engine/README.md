# Presentation operations

Shared PowerPoint package inspection, editing and byte transport for document
commands and conversion. This internal engine is bundled into the existing
Safe Bash package; it is not installed separately.

```ts
import { pptxCommands } from "@poe-platform/safe-bash/commands/pptx";

shell.use(pptxCommands());
```

The command supports an injected engine, cancellation and explicit argument
limits. Document operations preserve the existing presentation, OPC and byte
contracts. Shared resource limits remain unlimited unless explicitly configured;
external links are never fetched implicitly.

Custom engines can use `openPackageArchive` with a retained range source and an
explicit `workingStorage: { fs, directory, cacheBytes }` capability. It streams
member bytes, keeps package indexes in caller-backed storage, and stages rewrites
before writing an output sink. Unchanged members retain compressed payloads and
ZIP metadata. Always close the archive; the caller still owns the input and sink.
The default working cache is 1 MiB. Large workloads require an external safe-fs
backend because memory filesystems also keep spilled data in RAM.

The default `pptx validate` command uses retained input, caller-backed semantic
indexes and output sinks. `openRetainedPresentationValidation` (from the
`validation` entry point) exposes the same ten semantic rules with streamed
issues; close the result when finished. XML schema validation is not performed.
The default `pptx inspect` command also uses retained input and caller-backed
selection, inventory and text-style indexes. `stageRetainedInspection` (from the
`retained-inspection` entry point) stages JSON or human output before exposing it;
write it to a sink and close the result when finished. The archive remains
caller-owned. `pptx text get` uses the same admission and stores text bodies,
paragraphs, inlines and traversal state in caller storage. `openRetainedText`
(from `retained-text`) exposes replayable text streams and segment/paragraph/inline
iterators; consume each nested iterator before advancing its parent. Close the
result after reading. Its `fields()` iterator streams field IDs, types and cached
text; `fieldCount` supports exact-selection checks. `stageRetainedText` provides
the staged `text.get`, `fields.list` and `fields.get` command formats, preserving
original field caches independently of compatibility-projected text. Pass `'frames'`
as the fifth `openRetainedText` argument to read `frames()` and `frameCount` instead
of text/field contents. Frame formatting records stay in caller storage; numeric
properties are parsed incrementally, including arbitrarily padded values.
`stageRetainedText` also supports `text.frames.list` and `text.frames.get`.
`openRetainedNotes` (from `notes`) exposes a caller-backed `records()` iterator,
with replayable part/master references, speaker text and body IDs. Close it after
reading. `stageRetainedNotes` supplies `notes.list` and `notes.get` output with
complete graph validation and raw speaker-body semantics; the get format retains
its historical selection-before-validation ordering.
`stageRetainedDiff` (from `diff`) compares two retained sources in `structural`,
`raw`, `text`, `media` or `relationships` mode and returns `{ equal, output }`. Write the staged
output to a byte sink and close it afterward. Keys, media counts, snapshot values
and change ordering use caller storage. The default diff command uses this path
for every supported mode, including the default structural comparison. Structural
metadata and geometry use caller-backed records and traversal rather than heap
trees. Numeric property values preserve native binary64 rounding.
`openRetainedProperties` (from `properties`) exposes replayable metadata records
with streamed names, namespaces, parts and string values. Typed scalars retain
the buffered reader’s conversion semantics; close the view after reading.
`stageRetainedProperties` provides `properties.list` and `properties.get` output,
including name filtering and exact-cardinality checks for get. The default
command uses this retained path and stages output before writing stdout.

`openRetainedTags` (from `tags`) exposes replayable slide/presentation tag
records with names and values streamed from caller storage. `stageRetainedTags`
stages list/get responses and preserves opaque selectors and their locations.
The default tag read commands use this path, including stdin input.
`pptx xml get` also stages raw, JSON and pretty responses through caller storage.
`openRetainedXmlPart` (from `xml-parts`) exposes replayable original bytes and
UTF-8 XML streams with explicit `validationLimits`; pretty formatting preserves
mixed content and keeps its traversal spans in caller storage. Close the result
after reading. `stageRetainedXmlPart` supplies the staged command formats.
`openRetainedPackageExtraction` (also exported from `package-tools`) admits an
immutable retained presentation input and optional `{ parts }` selection before
exposing `members()`. Each member has a generated safe filename, part name, size,
SHA-256, streamed `contentType()` and replayable `bytes()`. Ordering, descriptors
and arbitrary content-type scalars use caller storage. Close the extraction to
retire its archive and indexes; the input remains caller-owned. Keep the input
and selection immutable until admission settles. This API does not publish files;
the default `extract` command consumes these streams through staged publication.
`stageRetainedExtractionOutput` stages its complete manifest and prefix boundaries
in caller storage, admitting success and failure output limits before publication.
Its `write(sink, failure?)` renders success or the exact completed prefix on failure;
close it after use. Diagnostic storage survives publication cancellation so the
completed prefix remains reportable. The borrowed extraction stays caller-owned.
`stageRetainedPackage` (also from `package-tools`) accepts an async stream of
`{ part, sha256 }` descriptors, an `openMember(part)` byte-source callback, and
explicit caller working storage. It admits all descriptors before opening any
member, verifies hashes and the complete presentation, and returns
`{ count, size, fingerprint, bytes(), close() }`. Member order, ZIP intermediates
and replayable output live in caller storage; close the result after consumption.
Optional `{ kind: "pptx" | "potx" | "ppsx" }` checks the presentation type.
The default `pack` command uses this API with retained manifests and inputs.
`openRetainedXmlReplacement` (from `xml-parts`) admits a replacement byte stream
for an exact existing presentation or slide part, including guarded child reorder
and removal. It retains replacement bytes and comparison state in caller storage,
checks package-wide mutation guards, and validates the candidate presentation.
Pass its `replacement` method to `archive.rewrite` to preserve unrelated members;
when `changed` is false, reuse the exact original archive bytes. Close the returned
view after rewriting. The archive remains owned by the caller.
`stageRetainedXmlReplacement` accepts an immutable retained presentation input, a
replacement byte source and selection options. It stages the rewritten archive and
human/JSON/binary response, exposes `bytes()` for publication and `output.write(sink)`
for the admitted response, and owns its staging until `close()`. The default
`xml set` command uses this path, including in-place and dry-run modes.
`openRetainedSlideSettings` (from `slides`) applies label and visibility changes
to a caller-backed part view, preserving mutation guards and validating the result.
It borrows the archive and returns `changed`, `affected`, original target locations,
and streamed part access. Pass its `replacement` method to the archive rewrite
API to preserve untouched compressed members. When `changed` is false, retain the
original archive bytes. Close the view after rewriting; publication remains the
caller's responsibility. `stageRetainedSlideSettings` accepts an immutable retained
input with `size`, range `read` and replayable `stream`, and stages the rewritten
archive plus the command response. Its `bytes()` source feeds atomic publication;
`output.write(sink)` emits the admitted response. Close the result after publication.
The default `slides set` command uses this path, including in-place and dry-run modes.
Other default operations and the synchronous presentation model still use buffered
APIs.
