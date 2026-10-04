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
original field caches independently of compatibility-projected text.
`pptx xml get` also stages raw, JSON and pretty responses through caller storage.
`openRetainedXmlPart` (from `xml-parts`) exposes replayable original bytes and
UTF-8 XML streams with explicit `validationLimits`; pretty formatting preserves
mixed content and keeps its traversal spans in caller storage. Close the result
after reading. `stageRetainedXmlPart` supplies the staged command formats.
`openRetainedXmlReplacement` (from `xml-parts`) admits a replacement byte stream
for an exact existing presentation or slide part, including guarded child reorder
and removal. It retains replacement bytes and comparison state in caller storage,
checks package-wide mutation guards, and validates the candidate presentation.
Pass its `replacement` method to `archive.rewrite` to preserve unrelated members;
when `changed` is false, reuse the exact original archive bytes. Close the returned
view after rewriting. The archive remains owned by the caller. The default
`xml set` command still uses its buffered publication path.
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
