# Shape text public surface evidence

This bounded receipt supplements the historical baseline in
[API audit](upstream-api-audit.md) and [test audit](upstream-test-audit.md).
It does not claim whole public object graph completion.

## Exact mappings

| Public member           | JavaScript mapping and observed behavior                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Shape.text_frame`      | Synchronous `TextFrame` getter; creates missing `txBody` in schema order and retains one live frame per shape. Its `parent` is the same owning shape object. |
| `Shape.text`            | Synchronous string getter/setter through that live frame; getter retains documented creating behavior, setter replaces paragraphs/runs destructively.        |
| `Shape.has_text_frame`  | Boolean query; true for `sp`, false for `grpSp`, and never creates XML.                                                                                      |
| Group text-frame access | Throws neutral `OfficeError` with `unsupported-edit`, without creating XML.                                                                                  |
| Inspection              | `readShape(XmlElement)` remains a noncreating domain query; no creating model getter is required for CLI reads.                                              |

There are no alternate camelCase aliases, new editor implementation, native runtime,
implicit network, host fonts, timestamps or ambient filesystem access. Tiny original
XML values remain in memory; no fixture files are created and no memfs adapter is
needed for these pure model tests. Namespace-aware splice primitives perform writes.
Text-body subtree views retain the admitted XML parser limits and namespace scope.

## Original acceptance evidence

`packages/pptx/src/shape-public-surface.test.ts` records frame return type/owner
identity, both directions of live text edits, getter creation, noncreating inspection,
group capability, and destructive assignment with paragraph-handle invalidation.
The first three tests failed before the shape edits (different frame object,
missing creating side effect, and incorrect true capability on a group).

Relevant baseline case obligations are the four `DescribeShape` text cases in
`tests/shapes/test_autoshape.py` at lines 323, 352, 361 and 369, and the `Shape.text`
getter/setter BDD examples at lines 18 and 23 of `features/shp-autoshape.feature`.
These map observable behavior into original cases rather than source mock internals.
Frame wrapper identity is deliberate target owner consistency, not a requirement
inferred merely from a source mock assertion. Existing broad inventories remain
historical; this receipt only covers the named members.

Focused final run: 46 tests passed across `shape-public-surface.test.ts` (4) and
`shapes.test.ts` (42), including the retained paragraph invalidation regression.
Final maintained package checks
are recorded by the coordinating implementation receipt.
