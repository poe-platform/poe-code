# Drawing follow-up evidence

This additive research receipt reconciles the existing bounded implementation
with [the drawing case ledger](drawing-case-map.json),
[the drawing API ledger](drawing-api-map.json),
[the test audit](upstream-test-audit.md) and
[the API audit](upstream-api-audit.md). Procedures are exclusively in
[the follow-up plan](../plans/pptx-drawing-followup.md). No reference executable
source or fixture was copied. Existing standalone license notices remain intact.

## Inventory reconciliation

Read-only JSON reconciliation found 295 distinct selected source identities:
226 parametrized unit variants and 69 expanded BDD scenarios. Every identity
resolves to the pinned test inventory; none is duplicated. All inventory
DrawingML BDD rows and DrawingML API records occur in their respective drawing
ledgers. All 34 distinct original file/title references in the case and API
ledgers exist in current TypeScript test files. Title existence is a linkage
check, not proof that every assertion or parameter is equivalent.

The case ledger explicitly distinguishes 252 adapted observable-behavior rows
from 43 deferred owner rows. Deferred counts are: chart owners 22, shadow owners
9, line owners 2, backgrounds 6, table owners 2 and font owners 2. These remain
visible obligations, with no parity credit from a similar shape-owned test.
The seven additional source tests about chart color variation by category
concern plot behavior rather than fill/color representation; they remain outside
this bounded drawing scope. Chart line-series construction, gridlines and
paragraph line spacing likewise do not establish line-format requirements.

The API ledger contains 223 unique IDs, all resolving to the API inventory:
119 marked implemented, 6 language-mapped, 1 documentation-error and 97
unsupported. These are ledger dispositions, not a whole-API completion count.
The remaining records include returned owner construction, inherited formatting
accessors, enum metadata/conversion helpers and stop XML/equality views.
Documented `_GradientStop` and `_GradientStops` interfaces remain included.

## Documentation reconciliation

The test audit's statement that adaptation has not started is its historical
checkpoint. Current drawing tests and implementation are later bounded evidence.
The same distinction applies to historical no-implementation statements in the
API/language research; they are not a description of today's entire package.

The API ledger conservatively marks `Shape.fill`, `Shape.line` and `Shape.shadow`
unsupported with a general returned-owner disposition. Current exported `Shape`
actually exposes `fill: FillFormat`, `line: LineFormat` and
`shadow: ShadowFormat` getters in `packages/pptx/src/shapes.ts`; original drawing
accounting tests exercise those getters. Treat those concrete bounded getters
as implemented behavior. This correction does not certify the complete live
presentation owner graph, inherited placeholder/movie/chart/table/background
owners, or all owner/view/equality APIs. The shared historical ledger was not
rewritten by this follow-up.

## Exact language and security mappings

- Model members retain `gradient_angle`, `gradient_stops`, `dash_style`,
  `fore_color`, `back_color`, `theme_color` and other neutral spellings. Typed
  operation JSON remains camelCase. No arbitrary property evaluator is exposed.
- Absent local fill has model type `null`; explicit no-fill has numeric type 5.
  Typed drawing records distinguish `inherit` from `none`. An omitted mutation
  field leaves the existing value unchanged.
- Model gradient angles are counterclockwise; typed drawing angles are clockwise.
  XML uses clockwise 60,000ths of a degree, with modulo-360 normalization.
  Path-gradient angle editing remains unsupported.
- Brightness is finite in [-1, 1]; alpha and stop positions are finite in [0, 1].
  Values are not coerced from strings/booleans. RGB accepts exactly six hex
  digits. Theme values remain scheme references; reading mixed system/HSL/
  scRGB/preset representations does not resolve them to sampled RGB.
- Gradient stops expose checked zero-based `.at`, `.length`, iteration,
  `includes`, `count`, `index` and `reversed`. Only namespace-qualified DrawingML
  `gs` children are members; foreign children and retained metadata are not
  stop objects. No unrestricted XML-library or host-object API is implied.
- Numeric model enum symbols and XML operation tokens are different surfaces.
  `PERCENT_40` resolves the documented spelling error; the typo is not a product
  alias. Unsupported enum helper/metadata records remain obligations.
- Model memory edits are synchronous; admitted I/O and package publication are
  async. Picture inputs are explicit bytes or capability-scoped VFS inputs;
  relationship reuse must target the selected owner. No ambient host I/O,
  network, native runtime, rendering, metrics discovery or wall-clock authority
  is implied. Read-only command inspection uses noncreating queries.
- Common command resource names, selectors, versioned JSON, schema/capabilities
  and exit codes follow the shared CLI contract. Direct drawing get/set and
  effects set call package behavior through the adapter; complete inherited
  model helper CLI coverage is not asserted.

## Preservation findings and verification boundary

The implementation owner reproduced three original regression failures in
`drawing-model-preservation.test.ts`: missing gradient and pattern fills were
inserted before transform/geometry, and gradient collections counted foreign
`gs` lookalikes/metadata and could edit foreign content. Focused fixes retain
schema child order and select members by namespace and local name. Advanced
DAGs, scene/material XML and unknown effects must retain their structure rather
than being flattened during unrelated edits. Destructive unsupported effect
replacement remains rejected.

This delegated worker executed inventory identity, uniqueness and test-reference
checks and inspected the implementation read-only. It did not execute package
unit tests, CLI acceptance, corpus rendering, a native runtime or the whole
pipeline. Maintained test/lint results and actual CLI verification are recorded
by the implementation/adapter owners. No speculative shadow-attribute defect is
claimed: zero-offset direction/alignment normalization alone did not establish
loss of unsupported semantic payload. The corpus manifest was consulted; this
worker downloaded, shipped and modified no corpus bytes. No commit, push or
release was performed by this worker.

## Integrated acceptance receipt

Root verification passed 2,767 PPTX unit cases, 49 focused registered-shell
command cases, package lint/type checks, the selected workspace build closure,
all 26 safe-bash type-consumer groups and complete guarded root lint with zero
errors or warnings. The original added CLI cases retain literal DAG/3D/material
and unknown-effect markup, reject destructive advanced-shadow edits without
publication, and check theme/RGB alpha endpoints, patterned lines, missing versus
no-fill and invalid bounds. The [integration receipt](../plans/pptx-drawing-followup.md)
records exact commands, disposable QA limits and the inspected help screenshot.
These results certify the stated bounded checks; the unsupported owner/API rows
above remain obligations. No whole-API or rendering-fidelity claim is added.
