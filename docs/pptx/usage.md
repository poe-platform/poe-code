# pptx usage

Draft for the private TypeScript ESM workspace `pptx`, not a published installation
promise. Commands run in a host that explicitly registers the safe-bash `pptx`
plugin and supplies a virtual filesystem. There is no standalone package binary.
The supported subset is discoverable with `pptx help`, `pptx schema --json` and
`pptx capabilities --json`; use `pptx capabilities deck.pptx --json` before edits
of unfamiliar content. Schema availability is not full format or API parity.

## Create, read and edit

```sh
pptx create --output draft.pptx --slides-json '[{"shapes":[{"name":"heading","x":0,"y":0,"width":3657600,"height":914400,"text":"Draft coastal survey"}]}]'
pptx inspect draft.pptx --json
pptx text draft.pptx
pptx text replace draft.pptx --find Draft --with Final --all --output final.pptx
pptx properties set final.pptx --name title --value 'Coastal survey' --in-place
pptx tables list final.pptx --json
```

Creation JSON geometry uses integer EMUs. Direct geometry flags accept `emu`,
`in`, `cm`, `mm` and `pt`. Conversion rounds once, halfway away from zero, and
rejects unsafe/nonfinite values. `--` terminates option parsing for filenames
beginning with a dash. Quote paths and literal text containing spaces or Unicode.
`text` is `text get`; use plural `images`, `tables` and `properties`.

CLI slide/image/table positions are one-based. Scope defaults to slide content;
notes, layouts and masters require explicit scope. `--slide 1 --shape heading`
selects by owner and exact label; ambiguous labels fail. An opaque `--select`
token from inspection is fingerprinted and fails after the package changes.
Do not mix tokens with simple selectors. Replacement requires exactly one of
`--first`, `--all`, `--occurrence N`. `--all` stays inside the selected scope.
A mutation matching nothing fails unless `--allow-empty` is explicit.

Use exactly one of `--output PATH` (`-o`) and `--in-place` for mutations.
Existing output files require `--force`; input aliases require `--in-place`.
`--dry-run --json` validates without publication. `--force` cannot bypass limits
or validation. `-` consumes byte stdin; one invocation has one stdin consumer.
`--output -` emits binary bytes and conflicts with `--json`, except in dry-run.
Directory outputs require a host transaction or explicit `--allow-partial-output`.

## Images

```sh
pptx images list final.pptx --json
pptx images add final.pptx --slide 1 --file logo.png --width 1in --height 1in --fit contain --output illustrated.pptx
pptx images replace illustrated.pptx --slide 1 --image 1 --file replacement.png --output refreshed.pptx
pptx images extract refreshed.pptx --output-dir images --allow-partial-output --json
```

Supply admitted local VFS image bytes; links are never fetched. Listing reports
occurrences; `--unique` groups identical resources. Replacement affects the
selected occurrence; `--shared` explicitly authorizes shared-resource replacement.
Sizing uses `contain`, `cover` or `stretch`. Check the image command schema and
capabilities for format/metadata restrictions; image characterization does not
promise decoding or rendering. Extraction preserves original bytes and reports
safe output paths and hashes. See [image details](images-usage.md).

## Merge and templates

```sh
pptx slides merge final.pptx --sources '[{"vfsPath":"appendix.pptx"}]' --theme-policy source --output combined.pptx
pptx template apply template.pptx --data-file bindings.json --output bound.pptx --json
```

Merge appends sources in order. Optional `--source-slides '[2,1]'` selects that
ordered list from every source. Theme policy `source` is supported; destination
theme conversion is rejected. Dimension policy defaults to `reject`; explicit
`destination` retains the destination dimensions without scaling imported shapes.
See [merge restrictions](slide-merge-split-usage.md).

`create --template` is a shared-contract target currently rejected with
`unsupported-profile` (exit 1). Apply bindings directly to an existing admitted
template presentation instead; do not rely on template-based creation.

For a template with `{{heading}}` on slide 1, `bindings.json` contains:

```json
[{"kind":"text","name":"heading","scope":"slides","slide":1,"cardinality":"one","text":"Coastal survey"}]
```

Bindings are literal text, fixed-grid table values or admitted image bytes.
There is no expression evaluation, script execution, URL lookup or recursive
expansion of inserted braces. Every recognized slot on a selected slide needs a
binding. Table bindings require matching unmerged dimensions. Notes/master binding
and table resizing are unsupported. The [repeat form](template-repeat-usage.md)
uses explicit prototype slide positions, ordered records and required
`shared-media` or `isolated-instance` policy. Layouts/masters/themes remain shared.

## Executable virtual shell example

Save this content as `review.sh` in the configured VFS and execute `sh review.sh`
in the registered safe-bash session. Input/output paths are relative to that
session's working directory; this is not a request to invoke a native shell.

```sh
pptx create --output 'draft deck.pptx' --slides-json '[{"shapes":[{"name":"heading","x":0,"y":0,"width":3657600,"height":914400,"text":"Draft coastal survey"}]}]' &&
pptx text replace 'draft deck.pptx' --find Draft --with Final --all --output 'final deck.pptx' &&
pptx text 'final deck.pptx'
```

## Public SDK imports

The exact declared ESM entry points are `pptx` and `pptx/bytes`. No deep source
imports are public. The [export catalog](sdk-exports.md) lists every current
runtime and type-only export; returned and inherited members are additional
obligations, not omitted because they lack an export or begin with `_`.
These examples use the following named imports:

```ts
import {
  Presentation, createPresentation, readPresentationText,
  replacePresentationText, addImage, mergeSlides,
  applyTemplateBindings, applyTemplateRepeat, createPptxCommandEngine,
  Inches, OfficeError,
  type SelectionContext, type ByteSink, type PresentationContext,
  type PptxCommandEngineOptions, type TemplateBinding
} from "pptx";
import { readBinary, writeBinary } from "pptx/bytes";
```

With explicit `context: SelectionContext` as configured below:

```ts
declare const context: SelectionContext;
declare const sink: ByteSink;
const input = await createPresentation({ slides: [{ shapes: [{
  name: "heading", x: 0, y: 0, width: 3657600, height: 914400,
  text: "Draft coastal survey"
}] }] }, context);
const text = await readPresentationText(input, {}, context);
const edited = await replacePresentationText(input, {
  find: "Draft", with: "Final", all: true
}, context);
const combined = await mergeSlides(edited.bytes, [input], {
  themePolicy: "source", dimensionPolicy: "reject"
}, context);
const presentation = await Presentation(combined, context);
presentation.core_properties.title = "Coastal survey";
// The caller supplies sink: ByteSink; it owns transport and publication.
await presentation.save(sink);
```

`addImage(input, {slide: 1, bytes: logoBytes, contentType: "image/png",
width: 914400, height: 914400, fit: "contain"}, context)` returns package bytes.
`applyTemplateBindings(input, bindings, context)` and
`applyTemplateRepeat(input, repeatOptions, context)` return a result with `bytes`.
All media bytes and binding records are explicit caller inputs.

Model spellings such as `core_properties`, `slide_layouts`, `add_slide` and
`text_frame` remain primary; operation options are camelCase. Factories, media
admission and save always return Promises. In-memory model operations are
synchronous. Whole-object `.text` assignment clears content within its documented
scope; it is distinct from formatting-preserving `text replace`.

Sequences use checked zero-based lookup, `.length` and iteration. Sparse
placeholder lookup uses IDs, not positions. Negative `.at` and slicing exist only
on declared collections; no universal array interface is promised. Returned
handles are live and owned; replacement invalidates old handles. Cross-document
assignment requires explicit import. `undefined` selects defaults; `null` retains
explicit absence/inheritance rather than false, zero or empty text.

Lengths are safe-integer EMU value objects (`new Inches(1).emu === 914400`).
Colors require bounded integer channels and exactly six hex digits. Enum aliases
retain typed immutable values; enum availability does not imply editing support.
Dates are explicit UTC `Date` values serialized to whole seconds. Byte results
are owned `Uint8Array` values. XML/package views are bounded, owner-aware views;
they expose no unrestricted evaluator or host resources.

## Configuration and limits

There are **no environment variables**, hidden host configuration, implicit
filesystem/network/native runtime, clock, identity or font discovery. Time,
author, cancellation and font metrics are explicit capabilities/options.
Host callbacks are trusted code and must enforce VFS roots and publication rules.
`PresentationContext` permits `timestamp`, `author`, `fontMetrics`, `signal`, and
the four limit groups below. A supplied group replaces that group's defaults;
supply every required field. Low-level operations require explicit groups.

| Group | Fields and current model defaults |
| --- | --- |
| `limits` | `maxBytes: 16777216`, `maxReads: 8192`, `chunkBytes: 65536` |
| `archiveLimits` | `maxArchiveBytes: 16777216`, `maxEntryBytes: 8388608`, `maxTotalBytes: 33554432`, `maxMembers: 4096`, `maxPathBytes: 1024`, `maxDepth: 32`, `maxPaxBytes: 4096`, `maxTextBytes: 8388608`, `chunkSize: 65536` |
| `xmlLimits` | `maxBytes: 8388608`, `maxNodes: 100000`, `maxDepth: 128` |
| `relationshipLimits` | `maxBytes: 8388608`, `maxParts: 4096`, `maxRelationships: 16384` |

The proposed format profile (256 MiB compressed, 1 GiB expanded, 50,000 entries,
32 MiB XML, depth 256, 5,000,000 nodes, 5,000 slides, 250,000 shapes, 256 MiB media,
100 megapixels if decoding is introduced, 512 MiB output, 1,000 batch operations)
is **not the current model default** or a guarantee every operation accepts it.
Corpus census limits are a separate QA profile.

`createPptxCommandEngine` requires `context`, `maxArgumentBytes` and
`maxOutputBytes`; context optionally supplies `validationLimits` with `maxBytes`,
`maxNodes`, `maxDepth`, `maxEntries`, `maxParts`, `maxRelationships`. Execution takes encoded
`args`, `signal`, `readInput`, and optional `preflightOutput`, `publishOutput`,
`publishOutputs` callbacks. Missing publication authority fails; a multi-output
callback must actually provide an atomic transaction.

CLI `--limit NAME=VALUE` lowers trusted ceilings: `maxBytes`, `maxNodes`,
`maxDepth`, `maxOutputBytes`; applicable extraction commands also accept
`maxOutputs`. Names must be distinct, values positive safe integers, and output
message budgets at least 512 bytes. Increasing a ceiling fails. Byte transport
has separate optional lower limits; see [transport details](package-usage.md).

## Results, failures and unsupported behavior

JSON returns one version-1 envelope: `version`, `operation`, `ok`, `data`,
`warnings`, `errors`, `affected`, `locations`. Operations use dotted IDs such as
`text.replace`. Reads and failed prepublication mutations have zero affected
objects. Diagnostics/progress use stderr; binary stdout remains pure bytes.

| Status | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Invalid content, unsupported edit, missing/ambiguous/stale selection |
| 2 | Usage/schema failure |
| 3 | I/O/publication failure |
| 4 | Resource limit |
| 130 | Cancellation |

Diff instead uses 0 equal, 1 different, 2 comparison failure, 130 cancellation.
Differences are successful SDK data. `OfficeError` exposes stable codes;
`ValueError`, `TypeError`, `IndexError`, `KeyError`, `PropertyAccessError` and
`InvalidHandleError` distinguish invalid values/types, bounds, keys, unavailable
or read-only properties and stale model handles.

Complete public API/format coverage and rendered fidelity remain unverified.
No rendering, native office automation, external-resource fetching, embedded
object activation, macro execution, arbitrary scripts/XPath or host font lookup
is supported. Missing explicit fitting metrics fails. General expression-based
templates, destination-theme merge conversion and general arbitrary-model batch
execution are unsupported. Full SmartArt/Morph semantics and universal extension
editing are not promised; preservation does not imply semantic editing. Strict,
signed, encrypted, macro-enabled and cross-dialect operations must be checked
against command-specific capabilities, not inferred from the file extension.
See schema/capabilities for actual edit/read/preserve/reject subsets.
