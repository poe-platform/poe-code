# Owner/chart API register reconciliation

This receipt supplements the historical `api-closure-current.md` checkpoint with
five executed bounded receipts. The denominator remains 2,409 inventory records
and 2,426 target rows, including inherited, underscore-prefixed and otherwise
untested obligations. Current partition: 12 bounded SDK receipt rows, 10 confirmed
unsupported rows and 2,404 rows not currently reconciled. None is whole API
coverage, and a bounded accessor receipt does not close its returned part graph.

| Exact source member | Current concrete acquisition and original evidence | Executed CLI equivalent |
| --- | --- | --- |
| `pptx.slide.Slide.part` | `Presentation(...).slides[0].part`; `slide-part-contract.test.ts` verifies live owner identity, copied bytes, rename, save/reopen and detached rejection | `xml get --scope slides --part URI --json` |
| `pptx.shapes.autoshape.Shape.part` | `slide.shapes.add_textbox` and `add_shape`; `shape-part-contract.test.ts` verifies owner and nested group binding | Same part byte route; JS reference identity remains model-only |
| `pptx.shapes.group.GroupShape.part` | `slide.shapes.add_group_shape`; same original owner test covers group/nested identities and live mutation | Same part byte route |
| `pptx.shapes.graphfrm.GraphicFrame.part` | Synchronous chart frame from `slide.shapes.add_chart`; `slide-chart-insertion-contract.test.ts` asserts slide owner identity | Same part byte route |
| `pptx.shapes.shapetree.SlideShapes.add_chart` | Same original insertion test covers frame return, live chart state, pending workbooks, replacement before save, two allocations and rejection atomicity | `charts add --slide N --type NAME --data JSON --left LENGTH --top LENGTH --width LENGTH --height LENGTH --output PATH --json` |

The central rows keep historical proposed batch commands under `proposed_cli`
and identify only these actual tested routes under `cli`. CLI emits versioned
results and bounded bytes rather than serializing JS object identity. The map
keeps `full_member_closure: false` because the complete returned graph and every
historical planned case have not been individually certified.

Exact language/security mappings:

- `.part` stays a synchronous readonly neutral property returning `PartView`.
  Detached access raises the existing `PropertyAccessError` / `property-unavailable`;
  stale drawing validation occurs before returning the owner. The receipt does
  not certify the historical proposed custom error for assignment to a getter.
- `add_chart(chart_type, x, y, cx, cy, chart_data)` stays positional and
  synchronous. `XL_CHART_TYPE` numeric values and registered chart-type names are
  accepted. Geometry uses `Length`; the model requires actual category/XY/bubble
  builders, while CLI accepts their typed JSON operation data. Wrong argument
  types raise `TypeError` / `invalid-type`; unsupported chart values raise
  `ValueError` / `invalid-value`. D02 corrects the return to `GraphicFrame`.
- Factory/save remain async, generated workbooks serialize at explicit save, and
  no host paths, runtime discovery, native process, network or copied reference
  fixture enters these tests.

`pptx.shapes.shapetree.GroupShapes.add_chart` is explicitly unsupported: its
receiver raises `unsupported-edit` before mutation. Its inherited public source
row remains present. No synthetic group CLI route is reported. Similarly,
`BaseShape.part` is not promoted merely because concrete Shape now implements
the accessor: the separately registered BaseShape public type is not exported.
No placeholder, movie, connector, table, text-frame or collection part row is
blanket-promoted from these five cases.

Validation: seven focused files passed 35 tests before the final argument
refinement; the insertion file then passed all 4 tests in 214 ms. The maintained
package lint reached passing ESLint and production TypeScript, with test-type
completion temporarily blocked by concurrently authored layout tests. Full
integration results are reported by the root owner separately. No corpus was
cleaned or downloaded for this receipt.

The partition above is the owner/chart checkpoint. The subsequent
[enum reconciliation](enum-public-register-reconciliation.md) adds exact bounded
symbol receipts and supersedes those partition totals without changing the
full denominator or promoting other owner methods.
