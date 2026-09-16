# Shapes and text-box evidence

Status: Bounded utility candidate passes original TypeScript and independent public/
Shell checks. Selected corpus outcomes, independent QA review and guarded root
lint pass within the limits below. Product delivery is local only. Full model/format
conformance is not claimed.

The sole format contract is [docx.md](../specs/docx.md), including the bounded F36
profile in section 6.5.1. Shared operation and model behavior remain governed by
office-cli.md and office-sdk.md. This evidence does not create a competing contract.

## Baseline observations at task 73 start

Main at investigation: `a4d977eb7e5e658aa65c0d94912ac8737b0177cf`; index empty.
Original small in-memory XML probes establish these separate observations:

- shapes.list/set currently refuse unsupported-profile before filesystem acquisition.
- Shape location kind, ordinal and selection integration are missing.
- Existing Office/VML and nested box reads return each active box once. An unsupported
  Office MCE Choice selects its VML Fallback without duplicating equal text.
- Existing box text edits refuse unsupported-edit before publication; this is current
  preservation behavior, not supported edit evidence.
- Exact Strict wp:wsp/wp:txbx/wp:txbxContent is admitted but has zero box stories; its
  paragraph leaks into the enclosing body index. A body-scope replacement can reach
  the leaked content and publish. This is a validated selection defect.
- A foreign opaque wrapper containing owner-WML txbxContent creates a historical
  read-only box story. Its attempted edit refuses; that discovery is not shape authority.
- A physical shared header box retains two references and rejects ambiguous edits.
- Office wps/wne content is not discovered. Its distinct namespace requires explicit
  opaque/read evidence and refusal rather than blanket local-name activation.

Preparation receipts: `/tmp/docx73-domain-textbox-edit-probes.log`,
`/tmp/docx73-domain-strict-native-box-probe.log`,
`/tmp/docx73-domain-native-groups-and-wne-probes.log`,
`/tmp/docx73-schema-original-probes-v1.json`,
`/tmp/docx73-schema-text-scope-probes-v1.json`,
`/tmp/docx73-schema-investigation-cohort-v1.json` and
`/tmp/docx73-reviewer-normative-prep-v1.json`. These are original probes, not
completed product tests or corpus/rendering evidence.

## Primary namespace evidence

Pinned Strict dml-wordprocessingDrawing.xsd: 14942 bytes, SHA-256
`725d64911076b34f1b2d60004cd14866fc0a399ab9808dc09415197a9e4dd144`.
CT_WordprocessingShape/CT_TextboxInfo use native wp:txbxContent in both dialects with WML
block children. It must be distinguished from owner-WML txbxContent.

Pinned MS-ODRAWXML section 5.2 permits optional w12 and wne text-body variants.
The wne URI is http://schemas.microsoft.com/office/word/2006/wordml. The default
optional wps box ID is zero; independent default zero values are not linked-flow
identity. Namespace recognition does not expand core-v1 MCE Requires support.

## Exact documented API dispositions

The pinned inventory remains historical. The following shape-member rows retain
their existing dispositions; utility F36 evidence cannot promote their live-model
implementation status.

| Source identity | Existing coverage disposition | Required JS mapping |
| --- | --- | --- |
| `docx.shape.InlineShapes` | planned / unmapped_not_implemented | Typed live owner/value API remains pending |
| `docx.shape.InlineShape` | planned / unmapped_not_implemented | Typed live owner/value API remains pending |
| `docx.shape.InlineShape.height` | planned / unmapped_not_implemented | Exact safe-integer Length getter/setter; geometry edits remain outside this utility profile |
| `docx.shape.InlineShape.type` | planned / unmapped_not_implemented | Typed live owner/value API remains pending |
| `docx.shape.InlineShape.width` | planned / unmapped_not_implemented | Exact safe-integer Length getter/setter; geometry edits remain outside this utility profile |
| `docx.shape.InlineShapes.part` | security-mapped / unmapped_not_implemented | Explicit bounded owner-part view; inherited Parented/StoryPart authority remains required |
| `docx.shape.InlineShapes.__getitem__` | language-mapped / unmapped_not_implemented | Zero-based sequence lookup, at/slice and typed bounds errors; distinct from one-based utility ordinals |
| `docx.shape.InlineShapes.__iter__` | language-mapped / unmapped_not_implemented | Symbol.iterator over live owned objects |
| `docx.shape.InlineShapes.__len__` | language-mapped / unmapped_not_implemented | length over live owned collection |
| `docx.enum.shape.WD_INLINE_SHAPE_TYPE` | planned / unmapped_not_implemented | Typed neutral symbols and all inventoried aliases/values remain required |
| `docx.document.Document.inline_shapes` | planned / unmapped_not_implemented | Live collection/returned owner remains pending; no utility promotion |
| `docx.text.run.Run.add_picture` | planned / unmapped_not_implemented | Live collection/returned owner remains pending; no utility promotion |
| `docx.parts.document.DocumentPart.inline_shapes` | security-mapped / unmapped_not_implemented | Live collection/returned owner remains pending; no utility promotion |

Exact shape-related API rows above: 13 (module/enum plus the three returned/owner
entry points). Exact pinned tests/test_shape.py unit cases: 13.
All remain research accounting; no original TypeScript pass is claimed here.
Document and DocumentPart inline_shapes getters, Run.add_picture return ownership,
inherited/public underscore-prefixed interfaces and all untested APIs remain additive
requirements of the API map. Factory/input/save admission is always async; admitted
live properties/model-only operations are synchronous. Null is explicit absence,
undefined applies declared defaults, bytes are owned Uint8Array values, units are
safe integer EMUs with shared rounding, and time/fonts/VFS authority is explicit.
No competing camelCase alias family, native runtime or ambient host access is implied.

## Preparation and retention limits

The corpus manifest/report and both upstream audits/inventories were consulted.
Manifest input identities remain provenance only; cache acquisition and census do
not establish product shape operations, text edits or rendering. Real publisher
artwork/binaries are not product fixtures. Task 71/72 caches remain retained with
their recorded limitations while their campaigns still need them. At preparation,
no task 73 download, corpus output, reference execution, rendering or cleanup had
occurred. The later selected-campaign results and owned cleanup are recorded below;
no new acquisition or reference execution was needed.
Every executable QA procedure must be an agent-executed Markdown plan in docs/plans.

## Verified candidate and remaining gates

Sole reconciliation was independently approved and committed locally as
`e8a8e37c5`; Proposed / Implemented Through Not applicable remains unchanged.
The product implementation is committed locally on main as `723314ac4`. Root owns integration,
exports and Git; domain 15/location 7/adapter 11 paths were assigned before edits.

The maintained selected DOCX build derives five stages from current declarations.
Full DOCX unit v1 passes 2,657/2,657 across 121 files; maintained DOCX lint/source/test
TypeScript checks pass. Guarded safe-bash typecheck builds once and passes 26 current
consumer groups and expected negatives; it is compile-only, with zero runtime
executions. Independent focused/public v1 passes 304/304 across 16 files, and actual
derived DOCX Shell passes 124/124 across 19 files without skips. The current 285-path
append-aware before/after cohort is exact, rather than the earlier historical 275.
No new runtime dependency or manifest/lock change is introduced.

Independent original probes validated and reduced four defects: non-carrier known
namespace wrappers acquired edit authority; mutable caller options changed dry-run
publication intent; shared-header inventory advertised mandatory-refused edits;
and the initial universal paragraph guard refused safe unrelated replacements.
Original regressions precede corrections, and independent revalidation proves the
four corrected outcomes. No copied code, assets or reference identities are used.

One native Strict public writer coverage gap was separately confirmed by a passing
original probe, without a product defect. A permanent original test now proves
actual assignment/readback, retained paragraph properties/native geometry and exact
inactive MCE bytes; writer 21/21, lint and test types pass. Its first attempt used an
invalid `token` option instead of `select`, preserved as test-setup failure. Only
that test file changed after the v1 freeze; all 36 other owned product inputs match.
Maintained full-unit v2 passes 2,658/2,658 across 121 files. Independent v2 renewed
writer 21/21 and authenticates the 285-path current cohort before/after. Prior
304/304 across 16 files and Shell 124/124 across 19 files retain exact unaffected
runtime/file bindings; no full 305-case rerun is claimed. Approval is recorded in
/tmp/docx73-reviewer-final-approval-v2.json.

New public writer tests also prove grouped/canvas/nested/linked/multiple/wne/shared
refusals, mixed supported/unsupported all-selection without stdout or changes to a
preexisting file, and active fallback edits with exact inactive alternate retention.
Those are original TS outcomes; they do not qualify real publisher inputs. Historical
API/model dispositions above remain unchanged and pending.

The separately owned QA campaign uses two admitted Transitional manifest inputs
and the fixed profile in the Markdown task plan. Reduced results, per-operation
supervision, inspected screenshots and sparse pre-cleanup inventory are recorded
below. Final real guarded root lint passes 12,650/12,650 configured files with
zero errors, 25 guard receipts and no gaps/unprocessed inputs; 12 warnings belong
to the unrelated PPTX QA cache. Its separate-stream run settled in 516.12 seconds
under the original 600-second ceiling. The earlier timeout and merged-capture
parser failures remain recorded in the task plan. No push, remote-main delivery
or publication is claimed.

## Usage draft for verified local routes

The explicit safe-bash plugin uses the same operation engine and SDK. These are
local verified routes; no published install or full live model availability is
claimed. Body is the default shape scope. Header/footer edits with multiple physical
references refuse; no shared or geometry option is provided by this utility.

```bash
docx shapes list report.docx --scope all-stories --json
docx shapes set report.docx --shape 1 --text 'Coastal findings' --output updated.docx
docx text replace report.docx --scope text-boxes --find 'Draft' --with 'Final' --first --output revised.docx
```

The setter requires one admitted simple paragraph and intentionally replaces its
runs/formatting while preserving paragraph properties and the carrier envelope.
Preserving text replacement retains unaffected runs. Grouped, nested, linked,
opaque/multiple-body and shared-reference selections refuse affected edits.

The root public route is `poe-code/docx`; callers provide admitted bytes and an
explicit context/stdout capability. Read and mutation entry points are async.

```javascript
const shapes = await inspectDocumentShapes(bytes, { scope: 'body' }, context);
const result = await editDocumentShapes(bytes, {
  operation: 'shapes.set',
  options: { shape: 1, text: 'Coastal findings', output: '-' }
}, { ...context, stdout });
```

The caller must inspect support/refusal details and choose an unambiguous admitted
shape. Read-only inventory does not grant geometry, group or renderer authority.

## Selected corpus qualification

[The reduced campaign](shapes-and-text-boxes-qa.json) records two admitted
Transitional inputs, 18 individually supervised operations and five inspected
screenshots. The fixed SDK profile used work 4 GiB, retained bytes 2 GiB and
eight million XML nodes. Actual normal Shell used work 512 MiB and two million
nodes, with the same explicitly admitted archive limits. Its factory cannot
accept the fixed SDK profile; same-profile corpus Shell parity is unavailable.

The circular-economy input has two stored alternate carriers and one active VML
fallback shape, in header37 with five section references. Its associated story
read succeeds. Whole-box assignment refuses ambiguous-selection with zero bytes
published. Normal Shell inventory and assignment hit resource limits before
semantic admission. The appendix has no shape candidates. Neither input has an
eligible simple unambiguous box setter, so real box-setter success remains
unqualified. Native Strict, active Office groups and nested/linked/opaque real
inputs also remain corpus gaps; original TypeScript tests cover their bounded
behavior separately.

Ordinary appendix body replacement succeeds through public SDK and actual normal
Shell, including a fresh output read. Their 2,071,144-byte outputs are identical,
SHA-256 `1eff6e54079036051af4692c9bca1aae2b762d69f84d62f6cbc9eb4ad70b4bdb`.
All 50 archive members keep their order; all 49 other member payloads, media and
relationships remain exact. Every document.xml byte outside the selected text
element is unchanged. This input has no active shape, so it does not establish
successful unrelated editing beside a real shared shape.

Circular body replacement refuses with “Archive output or retained byte budget
exceeded.” and zero published bytes. Reported work and retained usage are below
their respective ceilings; finer internal limit attribution is not established.
No limits were raised. The first wrong SDK argument order and first Shell binary
pipeline output-ledger failure remain preserved beside corrected invocations.
Direct VFS redirection succeeds at the identical 2 MiB Shell output ceiling.
These failures are not counted as product defects or successful unsupported edits.

No downloaded content, reference identity or native QA dependency enters product
source, tests, fixtures or build closure. The exclusive campaign cache has six
regular files totaling 12,737,065 bytes before cleanup. After root and independent
review, all six authenticated files were removed; the empty owned directory and
pre-cleanup inventory remain. Earlier caches and mounted tools were untouched.
No document rendering or watermark activation is claimed.
