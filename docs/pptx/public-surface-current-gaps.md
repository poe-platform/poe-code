# Public object surface review checkpoint

Date: 2026-09-13. This is a bounded source review at the start of the public
surface implementation task, not a whole-API coverage certificate or a test
execution receipt. Concurrent implementation can supersede individual findings.

Authority: [format specification](../specs/pptx.md),
[shared SDK](../specs/office-sdk.md), [shared CLI](../specs/office-cli.md),
[API audit](upstream-api-audit.md), [API inventory](upstream-api-inventory.json),
[test audit](upstream-test-audit.md), and
[test inventory](upstream-test-inventory.json).

## Confirmed baseline and gaps

| Area | Source evidence at checkpoint | Disposition |
| --- | --- | --- |
| Presentation root | `packages/pptx/src/index.ts` exports byte-oriented `createPresentation`, but no `Presentation` factory or live presentation/slides/layouts/masters graph. | Public graph coverage remains missing; byte operations are not equivalent to live synchronous model methods. |
| Existing model behavior | `shapes.ts`, `connectors-model.ts`, `text-frames.ts`, `text-paragraphs.ts`, `tables-model.ts`, `properties.ts`, and `links-model.ts` implement real drawing, text, table, property, and link behavior. | Reuse these types; a second shape/text/table editor would duplicate domain behavior. |
| Owner binding | `Shape`, `Connector`, and `Table` store their own XML state. Text-frame and fill children update that state, but there is no presentation owner joining all these changes into a live saved package. | Owner binding must include nested mutations and cached child handles. Reading a subtree into an independent model alone is insufficient. |
| Connector assignment | `Connector.begin_connect` and `end_connect` forward structural target views to `applyConnectorUpdate`. Its `sitePoint` requires exact target-node membership in the owned drawing tree. | Foreign/stale XML targets are already rejected by the domain behavior. The new live graph must preserve this guard while returning current nodes; the structural wrapper signature alone does not establish a bug. |
| Shared context | `ByteContext` holds limits/cancellation; `SelectionContext` adds package/XML/relationship limits. Creation takes explicit author/time options, and fitting takes admitted metrics separately. | A typed model context/default policy is still required; no ambient author, clock, font, filesystem, or network discovery is authorized. |
| Binary boundaries | `readBinary` is declared async and copies admitted byte arrays. `openPropertySession` and its `save` are async. The reviewed source signatures did not expose a value-or-Promise union. | This is a source inspection finding, not proof for all runtime branches or missing APIs. New model factories/save/input admission need explicit Promise tests. |
| Publication capability | `BinaryOutput` names a sink or `VfsPath`, but the reviewed `VfsCapability` only specifies `openRead`. | A model `save` cannot infer write authority from a read path; publication needs an explicit writable capability and stale/cancellation checks. |
| Other missing graph families | Index exports chart records/operations, image operations, path operations and enums, but no live chart graph/data builders, Image/Picture graph, or FreeformBuilder. | Keep these visible as outstanding public obligations; existing bounded format operations do not establish model parity. |

## Language and security mappings governing the implementation

The detailed J01–J10 register remains [api-language-mappings.md](api-language-mappings.md).
The applicable exact distinctions are:

- Neutral snake_case model members remain primary; operation JSON stays camelCase.
- Factories, save and admitted image/movie/OLE input methods always return Promises.
  Model-only edits, chart data builders and chart/table insertion remain synchronous.
- Missing optional arguments use documented defaults. Explicit null remains
  absence/inheritance only where supported, not a general default request.
- SDK sequence positions are zero-based; sparse placeholder keys are IDs.
  Negative indexes and slicing are per-collection promises, not universal additions.
- Returned model children remain live and owned. Foreign owner assignment fails,
  and replacement invalidation needs an intentional typed failure.
- Bytes are owned Uint8Array values; paths/streams require explicit capabilities.
  No default author/time/font authority is discovered from the host.
- Public underscore-prefixed types, inherited members and APIs without source
  tests remain in scope. An implementation name alone is not an exclusion.
- Read-only CLI routes must use noncreating inspection, even when a model getter
  intentionally creates missing notes, titles, text frames or definitions.
- Shared plural command resources, text replace, versioned JSON, scope selectors,
  schema/capabilities and exit statuses remain the command contract; model APIs
  require explicit typed routes rather than an arbitrary method evaluator.

## Documentation drift

The test audit's header says TypeScript adaptation has not started, and the
language mapping document says no passing product tests exist. Those are
historical research checkpoint statements: the API audit already links later
bounded receipts and the package contains original tests. They must not be read
as current package-wide implementation status. Conversely, the original inventory
rows labelled `not_implemented` are retained provenance; counting newer exported
symbols cannot silently convert all their inherited members into implemented rows.
Parsing the complete API inventory confirmed 2,407 records, all retaining that
historical status, including 849 properties, 169 lazy properties, 88 protocols,
716 enum members and 13 enum aliases. The test inventory retains 2,700 unit rows.
These totals describe inventory structure, not implemented or passing cases.

The API audit already records the concrete source documentation corrections:
CoreProperties module-path drift, GraphicFrame/Movie return annotations,
follow-master-background documented setter discrepancy, incorrect freeform close
and cell coordinate references, the pattern-name typo and missing notes enum.
This review does not reverse those resolutions or claim an additional published
documentation retrieval.

## Evidence boundary

No publisher binaries or reference runtime were used. No files were created by
unit tests as part of this review; no tests were executed by this documentation
subtask. Implementation receipts must name actual original acceptance tests and
executed maintained checks before marking any of these rows resolved.
