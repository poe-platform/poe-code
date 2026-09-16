# Chart and workbook inventory evidence

Status: Task74 bounded original TypeScript candidate-v2 passes maintained scoped
checks and independent product/corpus review. Local product commit is verified;
full model/API coverage, workbook consistency and rendering are not established.

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
probe proves inert binding preservation only, never XLSX validity. Those probes
were preparation; the original TypeScript evidence below separately verifies
bounded product behavior.

## Original bounded implementation and independent verification

The public inspector and charts.list return package-global physical definitions,
ordered native groups, stored lexical cache/source evidence and inert resource
bindings. Only json/limit apply. Unreferenced and opaque definitions remain visible;
style/color resources are not extra definitions. No model, utility batch,
spreadsheet validity, formula calculation, refresh or rendering is promoted.

Original recognition analogues are
packages/docx/src/charts.test.ts (chart graphics excluded from image inventory and
physical chart classification) and both matching-dialect inventory cases. They
cover utility recognition, not the pending live InlineShape.type or CHART enum.
Exact source case/API identities and historical dispositions above are unchanged.

Canonical originals cover all16 native groups, mixed/repeated groups, both
dialects, lexical sparse/duplicate/malformed caches, label and literal/reference
provenance, inert workbook MIME roles, style/color opacity, owner-local/cyclic
graph edges, scope poison, copied invocation bytes/options, output/cancellation
bounds and unrelated body/property edits. Downloaded data is not a unit dependency.

Independent review found duplicate empty source containers allowed compact
projections and missing autoUpdate values lacked issue evidence. Both were reduced
to seven original canonical failures before corrections. Empty containers now
retain opaque source evidence and make projections ambiguous; missing scalars
retain null with located issues. Earlier closure/order and inherited-key defects
also retain original REDs. A readonly Shell fixture type failure was corrected
immutably; construction/type-harness mistakes remain separately qualified.

Frozen candidate-v2 has21 owned product inputs. Maintained
/tmp/docx74-root-maintained-proof-v3.json authenticates DOCX2717/2717 across125
files, selected5builds, package lint/source/test types, portable public2/2 and
virtual-bash one-build26consumer-group compile-only success. Actual focused Shell
cohort passes125/125 across20 maintained-discovered files. Independent
/tmp/docx74-reviewer-final-approval-v2.json, SHA-256
b10a24ad2aaf83efced24b3fce7a6ef5ccecf78973c5b02667aac1d052e49b84,
approves four public SDK correction probes, focused55/55 and independent actual
Shell125/125 with exact296 captured paths/21owned append-aware bindings. This is
bounded feature evidence, not a full virtual-bash unit or full API gate. Corpus
qualification is recorded below; final root guarded lint and local product commit pass.

## Bounded corpus outcomes

Reduced evidence is [charts-and-workbooks-qa.json](./charts-and-workbooks-qa.json).
Ordinary SDK and normal Shell annex reads retain their limit failures. The fixed
dense SDK profile reads three physical definitions, nine series, 26 stored caches
and 13 inert graph parts. Independent outer ZIP/XML inspection agrees with the
physical references and graph inventory. The declared 120,626-byte workbook stays
opaque. No workbook validity or consistency follows from those bindings.

The full-annex body edit fails the validation byte limit with zero publication;
its initial cardinality setup error is retained separately. Full-annex editing,
round-trip and same-profile SDK/Shell parity remain unqualified.

A separate 255,101-byte authored QA carrier has 20 members, including 16 exact
copied chart/resource/relationship closure members and three semantic incoming
edges. Its ordinary SDK and normal Shell reads match complete data, warnings and
revision-bound locations. Dense SDK, ordinary SDK and normal Shell body edits
produce identical 255,192-byte outputs, SHA-256
a99d0f76ba40c8902b3cd70eb7a1b24f4a528505624ef0a4432b39efcd6fa1f4.
Member order, all 19 other members, copied closure bytes and relationship graphs
remain exact. This carrier is disposable corpus-derived QA, not a canonical unit
fixture or a qualification of the full annex. A genuine virtual .sh chart read
also matches direct Shell stdout exactly.

Four fixed 100-column terminal screenshot replays were actually inspected by root
and the QA owner. The original wide help image fails the unchanged 8192-pixel
dimension admission before display; that failure survives. Replays preserve all
non-newline transcript text without clipping. Root's external display watchdog
acknowledges all four at 106.493 seconds under the 120-second ceiling; opaque image
tools cannot be forcibly preempted by that observer. Different-worker QA approval
/tmp/docx74-reviewer-qa-final-approval-v1.json, SHA-256
eb5023cce16abb04dd9c96ce8f4ec28bd2d8ca75cd90db2a803497e0238b0a10,
independently authenticates all 15 operations, 21 product inputs, 27 campaign files,
carrier parity/preservation and four actual images. Exact cleanup removes all 27
manifest campaign files (10,586,275 logical bytes), leaving the empty directory and
original corpus source untouched. Reduced hashes, profiles, failures and findings
survive in the QA record; no downloaded asset enters the commit. No chart rendering
is claimed.

Different-worker post-cleanup authentication:
/tmp/docx74-reviewer-post-cleanup-authentication-v1.json, SHA-256
f0e4e0a08587415018ef6e3166e2ef51c05a23aa78012c1c4fee8ad664ee88f8.
Final maintained root guarded lint passes in 508.847 seconds with 12,659 subjects,
zero errors, 12 warnings, all 25 receipts complete and no gaps. Complete JSON and
separate-stream proof is /tmp/docx74-root-final-lint-proof-v1.json, SHA-256
b3f281d003fce8eeedc655be6778d55f048c17ab810df48b2d1c2431fd397799.
Original TS tests, public probes and canonical fixtures remain independent of the
cleaned campaign. Local product commit is
d5b8521122d41a7533b5dcd08f49b7c8a757367c,
`feat(docx): add bounded chart inventory`, exactly the 21 frozen product paths and
task plan. QA/status evidence is delivered separately. No push, remote-main
delivery or release publication occurred. This closes bounded task74; full
model/API, workbook consistency and rendering remain pending.
