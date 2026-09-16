# Image replacement evidence and compatibility boundary

This receipt records bounded replacement research and executed disposable corpus
QA. Maintained unit/lint/build gates remain with the owning implementation agent.
It does not establish whole-public-API parity or image rendering fidelity.

## Exact source-row accounting

[The case ledger](image-replacement-case-map.json) retains 125 exact source rows:
84 unit variants and 41 expanded BDD scenarios. It carries forward every one of
[the insertion ledger's](image-insertion-case-map.json) 121 rows, preserving exact
selected parameter bindings and prior evidence, and adds all four adjacent
picture-placeholder unit cases from the complete source ledger. No direct
image-resource-replacement method/scenario was identified in the pinned baseline;
clone/rebind and shared replacement are original F32 requirements.

The 12 unit crop-setter variants cover creating each side, updating each side and
clearing each side to zero; the 16 BDD crop-setter examples cover all four sides
with absent/existing crop and zero/nonzero values. These are still independent
model-setter obligations. Replacement preservation/reset tests cannot be used to
claim them as fully adapted. Seven unit crop getters and two BDD crop getters
retain their earlier inventory evidence. Other exact rows retain their recorded
admission, MIME, sizing, deduplication, placeholder, outline/mask and media gaps.
The ledger does not combine parameter variants or upgrade unexecuted cases.

[The complete test audit](upstream-test-audit.md) is historical baseline research;
its “TypeScript adaptation not started” line does not describe the current
bounded package operations. Existing original image tests and newer focused
receipts establish those subsets. Its 2,700 unit/973 BDD pass counts never prove
the replacement operation.

## Exact JavaScript and security mapping

- The operation is always asynchronous: the presentation uses `BinaryInput`,
  while replacement image content is an explicit `Uint8Array` and declared MIME.
  The CLI admits image paths through its supplied VFS before calling the SDK.
  Strings do not authorize host reads. No image decoder,
  native runtime, external-link fetch, network or ambient filesystem is added.
- An occurrence is identified by a fingerprint and owning part/structural object
  selection; relationship IDs are local to their source part. CLI positions use
  one-based coordinates. Shared-resource mutation requires explicit intent.
- Occurrence-local replacement rebinds only the selected XML reference. Shared
  replacement reports actual affected occurrences, not merely unique resources
  or slide count; slide, master and notes ownership remain distinguishable.
- Geometry is DrawingML integer EMU metadata. Crop is serialized percentage
  metadata, including preserved pre-existing negative or greater-than-one values;
  it is not pixel rendering. Alt text is XML text, preserving Unicode and escapes.
  Explicit replacement policies are distinct from arbitrary model setters.
- Input admission and output publication obey the supplied limits and
  cancellation context. Cancellation must leave an existing destination intact.
  SDK failures are typed; CLI cancellation is 130, usage/schema errors 2,
  validation/selection/unsupported errors 1, I/O/publication errors 3 and limits 4.
- `images replace` is the plural resource route and uses the same domain operation
  as the SDK. JSON operation options use camelCase. The shared SDK's neutral
  snake_case model members remain separately required, with no blanket alias layer
  or arbitrary method/property evaluator.
- Byte identities use SHA-256. The documented `sha1` member remains compatibility
  metadata; it cannot replace integrity verification or collision-safe identity.

These follow J01–J10 in [the language/security mappings](api-language-mappings.md)
and the shared [SDK](../specs/office-sdk.md)/[CLI](../specs/office-cli.md) contracts.
Implementation-specific options and observed results belong in the final receipt,
not inferred from these requirements.

## Public API and documentation drift

[The image API map](image-inventory-api-map.json) retains 99 image-family public
records, including inherited members and returned movie/placeholder interfaces.
Image bytes, type, DPI, size, filename, extension and SHA-1 model properties;
Picture crop/outline/mask properties; placeholder insertion/handle invalidation;
and collection/constructor/helper obligations are not implemented merely by an
operation returning detached data. This applies equally to APIs without upstream
tests and to public types whose names begin with an underscore. The complete
2,407-record API inventory and its enums/inherited graph remain authoritative
obligations; this bounded task does not hide or reclassify any of them.

The API audit's final historical “no JavaScript API” paragraph is superseded for
bounded operations by the linked implementation receipts, but remains relevant
as a whole-model gap. Published documentation version 1.0.0 versus pinned source
1.0.2 remains documented drift. Notes drawing inspection does not invent a
`NotesSlideShapes.add_picture` method. Replacement of an existing notes occurrence
is a separate explicit operation. Crop preserve/reset options do not close the
source's public crop setter requirements. PNG/JPEG/GIF admission is the existing
bounded subset; format metadata inspection does not establish BMP/TIFF insertion
or arbitrary image decoding.

## Provenance and QA state

Only source identities, parameter bindings and research mappings are retained in
this document family. Product tests/assets must use original wording and bytes.
Existing [MIT notice](upstream-license-notice.txt) and
[case-map notice](test-case-map-notice.txt) remain unchanged; no source code or
publisher binary is copied into product assets by this task.

All fourteen corpus paths listed in [the manifest](corpus-manifest.json) existed
when inspected. This is presence evidence only, not hash revalidation, product QA
or visual evidence. The bounded QA procedure and selected disposable shared-image
fixture are recorded in [the plan](../plans/pptx-image-replacement-accounting.md).
No downloads or fixture mutations were performed. The subsequent corpus product
run is recorded below; all outputs remained in memory.


## Executed disposable QA

Executed on 2026-09-13 using inline `node --import tsx --input-type=module` and the
SDK source. No QA script or output binary was persisted. The manifest-selected
43,231-byte input was SHA-256 verified before and after the run:
`85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d`.

Inventory established two structural occurrences of `/ppt/media/image1.png`:
slide 1 and layout 2, with the layout inherited by slides 2–4. Original PNG hash:
`8b303c9c9273e311993982c03db2d20ee19b8aed4590e9696a564e7bf29ef4a3`.
The replacement was the original 43-byte GIF authored in the replacement unit
suite, hash `37691347c2fd9b81b82abb97ebc4f262aa2a48d72d8369bb7a5bc5cea70fd122`.

| Operation | Occurrences reported | Affected slides | Result |
| --- | ---: | --- | --- |
| Default occurrence-local | 1 | 1 | GIF clone added; PNG and layout XML/relationships retained byte-for-byte |
| Explicit shared | 2 | 1, 2, 3, 4 | Both slide/layout occurrences rebound; obsolete PNG, PNG content-type default and relationship targets removed |

Both outputs preserved all occurrence crop/geometry/alt metadata. Independent
archive member hashes matched expected media bytes. The original and both
outputs passed all ten `validatePresentation` graph/semantic rules with no
issues, including content types, relationship targets, master/layouts and notes
associations. Schema validation was explicitly `not-checked`; no renderer ran.
The local output was 42,936 bytes, hash
`cd81561c05cba6ab2a3dad63b3556a3157c2225e644456cf4e6c40d25afb2b4b`;
the shared output was 31,727 bytes, hash
`984f871693fcbbc7119f36fa41b00af9bdee7984abc0aa1b4c891e5480cc4296`.

The initial QA invocation omitted required `maxEntries` validation limits and
correctly failed with `invalid-value`; adding the explicit QA limit enabled the
run. This was harness configuration, not a product defect. No meaningful product
finding required a new regression. The real-world fixture supplements the
original master/notes sharing tests, rather than establishing those owners itself.

## Original replacement regression references

The source file `packages/pptx/src/image-replacement.test.ts` contains 28 expanded
original cases. Its primary assertions independently inspect archive XML/bytes
using memfs and a separate XML parser. Exact named evidence includes:

- `clones only one occurrence across slide master and notes sharing, Strict=%s`
  (two dialect variants).
- `replaces a shared part with all affected occurrences and removes stale declarations`.
- `applies explicit crop geometry and alternative-text reset only to selected occurrences`.
- `selects a master occurrence explicitly without changing its shared peers`.
- `cancels asynchronous acquisition without mutating input`.
- `removes old media and content types after explicitly replacing every occurrence locally`.
- `rejects paired vector bindings before creating stale fallbacks`.
- `cleans a removed media override with case-equivalent part spelling`.
- `rejects media with its own relationship graph before removing its owner`.

The paired command tests in `packages/pptx/src/command-images-replace.test.ts`
include `rebinds one image and validates the affected occurrence report against schema`,
`applies explicit shared replacement and preservation policies`,
`validates dry runs and cancels before publication`, and
`retains an existing destination when cancellation interrupts image admission`.
Root verified the final maintained package run: 110 files and 3,140 tests passed,
including 28 domain and 10 command replacement cases. Maintained package lint and
build passed; the actual safe-bash replacement test and all 107 integration
registration checks passed. Help and error screenshots were inspected. The
supplemental tests do not upgrade any source-model crop setter or placeholder
obligation in the case ledger.

The required root guarded `npm run lint:eslint` is incomplete: exit 2 at the fixed
12,000-subject cap, with 12,000 subjects linted, zero errors and zero warnings.
The next configured subject was `packages/acp-telemetry/src/trace-sink.ts`.
The scoped guard rules require retaining other limits, so the cap was not changed
and no alternate/excluding lint route was used. This is not a successful root lint
check. Local commit is blocked by the requested successful-check prerequisite;
no files were staged or committed, and nothing was pushed or released.
