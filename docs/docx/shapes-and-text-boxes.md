# Shapes and text-box evidence

Status: Task 73 preparation and sole-contract reconciliation; product implementation,
original TypeScript acceptance, CLI/SDK parity and corpus QA remain unverified.

The sole format contract is [docx.md](../specs/docx.md), including the bounded F36
profile in section 6.5.1. Shared operation and model behavior remain governed by
office-cli.md and office-sdk.md. This evidence does not create a competing contract.

## Current-code observations

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

Exact shape API rows above: 10 (the shape module plus returned enum). Exact pinned tests/test_shape.py unit cases: 13.
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
their recorded limitations while the campaign still needs them. No task 73 download,
new corpus output, reference execution, rendering or cache cleanup is claimed.
Every executable QA procedure must be an agent-executed Markdown plan in docs/plans.
