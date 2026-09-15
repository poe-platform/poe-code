# Chart and workbook inventory evidence

Status: Task74 sole wording is independently approved. Original TypeScript tests,
implementation and product QA are pending.

The sole format contract is [docx.md](../specs/docx.md); shared behavior follows
office-cli.md and office-sdk.md. Execution/QA procedures belong only in
[the task plan](../plans/docx-charts-and-workbooks.md).

## Baseline and drift

Main at start: 65470660cb88f6058b4f6bce0a08b7484452843f, empty index. Original
in-memory engine/Shell probes reject charts.list before filesystem reads. Existing
selectedRead/schema flags cannot resolve a chart owner; discovery rejects F37 and
no public chart inspector is exported. The existing result outline does not define
mixed plot groups, cache freshness/provenance, sparse point indices, externalData,
workbook/style/color relationship status or unreferenced definitions.

The proposed reconciliation uses package-global physical chart-part identity.
Part count must not be presented as active rendered chart occurrences. Stored
formula/address text remains inert, cached values remain labeled as stored caches,
and workbook/resource bytes must never be activated or refreshed.

## Exact source accounting

The pinned python-docx test inventory contributes two chart-recognition cases:
drawing graphicData/a:chart is not a picture, and the InlineShape chart namespace
maps to the CHART type. They do not verify chart-series/workbook APIs. The API
inventory's CHART enum value12, aliases and inline-shape owner/type interfaces
retain their existing planned/language-mapped dispositions; utility inventory
must not promote their model statuses or exclude inherited/public interfaces.
The source commit is `e45454602b53e8e572b179ccf1c91093ec9f4ed7`.
Exact unit identities (zero-based inventory indices846 and983) are:

- `tests/test_drawing.py::DescribeDrawing::it_knows_when_it_contains_a_Picture[w:drawing/wp:anchor/a:graphic/a:graphicData/a:chart-False]`
- `tests/test_shape.py::DescribeInlineShape::it_knows_what_type_of_shape_it_is[http://schemas.openxmlformats.org/drawingml/2006/chart--WD_INLINE_SHAPE_TYPE.CHART]`

These are recognition obligations; original utility classification tests are
semantic analogues, not proof of live Drawing/InlineShape implementations. Source
rows remain `unmapped_not_implemented`. Related API inventory indices92/93/95,
348–350 and866/867 remain historical; exact current identifiers/statuses are
recorded below before implementation.

| API identity | Historical coverage | Required disposition |
| --- | --- | --- |
| `docx.shape.InlineShapes` | planned | Live collection remains pending |
| `docx.shape.InlineShape` | planned | Live owner remains pending |
| `docx.shape.InlineShape.type` | planned | Enum-valued live classification remains pending |
| `docx.shape.InlineShapes.__getitem__` | language-mapped | Zero-based lookup/at/slice/bounds; remains pending |
| `docx.shape.InlineShapes.__iter__` | language-mapped | Typed iteration; remains pending |
| `docx.shape.InlineShapes.__len__` | language-mapped | Length; remains pending |
| `docx.enum.shape.WD_INLINE_SHAPE_TYPE` | planned | CHART value12 and complete enum remain pending |
| `docx.enum.shape.WD_INLINE_SHAPE` | language-mapped | Neutral canonical enum alias remains pending |

Utility async input admission, revision-bound part snapshots, lexical stored-cache
values and explicit capability I/O replace unrestricted host/workbook behavior.
They do not complete inherited owners, collections, enums or property setters.

## Sole reconciliation approval

Section6.5.2 resolves package-global read options, exact physical identity,
closed source/cache/point/binding types, deterministic projections, role MIME/URI
register and opaque/inert dispositions. Sole SHA-256 is
3bd51924925de0f0a257cae7327464b28e8abc135ebdeb241ad6de29368989ba;
checker zero warnings. Independent approval:
/tmp/docx74-reviewer-wording-approval-v2.json, SHA-256
5d1ef7c727d21ec1616fed10cf4a108593b654ef5a789af2bfe42ee0429bcf3b.
The rejected v1 draft/review is retained. Proposed / Implemented Through Not
applicable remains unchanged. Approval authorizes original TS TDD, not product
implementation, model parity, workbook consistency or corpus QA completion.

The corpus annex correction is three chart definitions and six support XML parts
(three styles, three colors), rather than the historical nine-chart census label.
Acquisition and reference passes are preparation only. No downloaded binary,
source passage, reference identity, copied source or native dependency enters
product/tests/fixtures/build closure. Corpus remains QA-only in ignored disposable
storage; no new acquisition or product operation is claimed by investigation.

## Primary schema and compatibility evidence

Existing publisher sources were admitted as bounded regular XSD files before
inspection. Strict dml-chart.xsd is74,388bytes, SHA-256
189b9631129a7d6c9f971b42b94c8942d260f11f81615f427db059bbf442cdc3;
Transitional SHA-256 is
4de4390a26e7e44e682ed98b39872cce2620f807f5b0de421567a43f74526388.
The pinned native CT_PlotArea vocabulary has16 chart-group forms; CT_StrData/
CT_NumData retain optional ptCount and repeated indexed points, CT_SerTx has
literal/reference alternatives, and CT_ExternalData has stored autoUpdate.
Receipt: /tmp/docx74-root-primary-chart-schema-v1.json. No schema file is shipped.

An original cross-dialect probe throws invalid-package because a chart root uses
the opposite package dialect. The sole reconciliation retains that admission
guard and tests both namespaces in matching documents; no conversion or expanded
compatibility/source ownership is authorized. The domain's8-byte opaque workbook
probe proves inert binding preservation only, never XLSX validity. Both facts
remain preparation evidence until original TypeScript product tests pass.
