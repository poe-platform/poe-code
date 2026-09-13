# Shape adjustments and freeform API receipt

This receipt covers model behavior, not whole-public-API completion. Root export,
shape-collection integration and shared command validation are separate checks.

## Research provenance

The pinned reference revision is
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. Explicit research reads obtained
[spec.py](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/spec.py),
[autoshape.py](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/shapes/autoshape.py), and
[freeform.py](https://raw.githubusercontent.com/scanny/python-pptx/278b47b1dedd5b46ee84c286e77cdfb0bf4594be/src/pptx/shapes/freeform.py).
Only neutral numeric/default guide facts were extracted from the 182 preset
entries (121 have nonempty adjustment sequences). Package
THIRD_PARTY_NOTICES.txt already retains the required standalone MIT notice.
No reference source runtime is imported or invoked by product code or tests.

## Exact language/security mappings

| Public behavior | JavaScript target and observable mapping | Original evidence |
| --- | --- | --- |
| Adjustment effective value | `effective_value: number` read/write; normalize raw integer by 100000, truncate assignment toward zero; preserve negative and above-one values | shape-adjustments.test.ts normalized/raw case |
| Adjustment raw value | readonly `val: number`; actual zero overrides the default | same case |
| Adjustment collection | `[index]` get/set, `.length`, `.at(index)` with negatives, `Symbol.iterator`; numeric brackets require nonnegative integral positions | collection/default/index cases |
| Assignment | writes all ordered effective guides, retaining unassigned raw integers exactly; unrelated paint survives | full-guide and untouched-integer regression cases |
| Typed operation | `ShapeUpdate.adjustments: readonly number[]`, exact guide count; command owner exposes shapes set | typed operation case |
| Unknown formulas | matching nonliteral guide fails `unsupported-edit`; no formula interpreter, coercion or host callbacks | formula rejection case |
| Builder creation | `FreeformBuilder(insert, start_x=0, start_y=0, scale=1)` uses explicit owner insertion capability; normal public acquisition is collection `build_freeform` | builder tests; collection integration owned separately |
| Builder drawing | `add_line_segments(vertices, close=true)` and `move_to(x,y)` return the same builder; coordinates are finite, rounded using shared Length rounding | sequence and geometry cases |
| Builder conversion | `convert_to_shape(origin_x=Length(0), origin_y=Length(0))` returns owner insertion result; repeat conversion retains builder operations | geometry/reuse case |
| Builder offsets | readonly `shape_offset_x`, `shape_offset_y`: Length in local coordinates; include initial point and all move/line endpoints | live offsets case |
| Builder sequences | `[index]`, `.at(index)`, `.slice(start?,end?,step=1)`, `.length`, iterator, `includes`, `count`, `index(value,start=0,stop=length)`, `reversed` | all sequence protocols case |
| Returned drawing operations | `DrawingOperation` represents move/line/close; move/line expose readonly `x`,`y`: Length; close has no coordinates | returned-operation case |
| Operation application | `apply_operation_to(path: FreeformPath)` accepts a bounded typed path only and translates using current owner bounds | bounded application/live offsets cases |
| Path capability | readonly copied/frozen `commands`; `append(command)` validates bounded finite commands | path case |
| Errors and limits | invalid numbers ValueError, types Model TypeError, bounds IndexError; 4096 serialized commands, DrawingML geometry bound ±27273042316900, positive finite scale; admission before mutation | malformed/overflow tests |

The path capability is an explicit security mapping for the XML dependency's
CT_Path2D interface. It grants no XPath, arbitrary method invocation, host I/O or
network. Returned underscore-prefixed source operation interfaces remain covered
by neutral DrawingOperation members; their names were not used to exclude them.

The source collection truncates normalized assignments, whereas shared length
conversion rounds halfway away from zero. The target preserves that deliberate
per-domain distinction. Numeric false/null/string coercions are rejected.
Public constructor implementation parameters are capability wiring, not promises
of unrestricted raw XML allocation.

## Documentation drift resolved

The guide's `FreeformBuilder.close()` does not exist; closure is the `close=true`
argument to `add_line_segments`. Source public `shape_offset_x`/`shape_offset_y`
properties were missing from the API inventory expansion and are implemented
and tested here. They are appended as exact tested language-mapped records in the overall inventory.
This receipt does not relabel unrelated inventory rows as implemented.

## Validation

Initial tests failed on absent modules. Later targeted regressions failed before
fixes for ignored typed adjustments, unassigned-guide truncation and operation
translation. Current focused suite has 16 original cases, including table-wide
preset admission. Tests operate on original small parsed XML or value objects;
they do not create files, so no filesystem substitute is needed for those cases.
Maintained package lint and unit results are reported by the root integration
receipt after all collaborators finish.

The source classmethod `FreeformBuilder.new(shapes,start_x,start_y,x_scale,y_scale)`
is a construction helper, not a separate documented raw-XML allocation contract.
Its rounded start coordinates and two scale factors map to the public owning
collection `build_freeform(start_x,start_y,[x_scale,y_scale])` and the explicit
owner-capability constructor. No runtime classmethod alias is promised; construction
behavior is exercised by the builder/collection tests rather than excluded.

Owner XML, insertion and offset callbacks use ECMAScript private fields. Original
reflection regressions verified they cannot be recovered through public own-property
lookup or enumeration; the initial TypeScript-only private fields failed those tests.

Adjustment operation arrays are capped at 4096 entries and require every numeric
position to be an own property; sparse/inherited entries fail before owner reads.
Model replacement and command preflight share this validation. Original tests
failed before the fix for holes, oversized arrays and premature owner reads.
