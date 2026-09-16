# Connector inherited formatting surface

This receipt updates the historical unimplemented labels only for the named
members in `upstream-api-inventory.json`; whole-public-API coverage remains open.

| Inventory member | Target behavior | Evidence |
| --- | --- | --- |
| `Connector.shadow` inherited from `BaseShape` | Synchronous stable `ShadowFormat` getter over the current connector XML, with no creating read | `connector-public-surface.test.ts`, both namespace cases |
| `ShadowFormat.inherit` through `Connector.shadow` | Existing synchronous getter/setter; setter uses the existing drawing mutation engine and preserves siblings/extensions | Same namespace cases and destructive-restoration rejection |
| `Connector.placeholder_format` inherited from `BaseShape` | Synchronous metadata record using the existing placeholder parser and `PP_PLACEHOLDER_TYPE` enum; missing placeholder throws neutral `ValueError` | Explicit/default/absent placeholder cases |
| Returned `_PlaceholderFormat.idx` and `.type` | Zero-based sparse index and neutral enum value; omitted attributes retain `0` and `OBJECT` defaults | Explicit/default placeholder cases |

The underscore-prefixed returned interface remains part of the public obligation.
Its structural TypeScript mapping matches the existing Shape metadata record; no
new raw XML constructor or alternate editor is introduced. Metadata results are
snapshots; obtaining the property again reads current XML. Mutating a returned
record does not edit the presentation. No object operation admits external input,
returns a Promise, discovers ambient author/time/fonts, or uses filesystem/network
capabilities. Byte input is limited to tiny original test XML in memory.

The existing `connectors-model.test.ts` continues to verify synchronous geometry,
line edits and rejection of foreign/stale connection target XML. The inherited
shadow tests verify failed edits retain the identical published `XmlPart`, and
that a retained shadow object still edits current XML after another model edit.

CLI drawing inspection/mutation already uses the same `readDrawingFormat` and
`applyDrawingUpdate` behavior; this closes object access without adding command
aliases or changing command output. The shared CLI plural resources and JSON
contracts are unchanged.

The source test obligation
`tests/shapes/test_base.py::DescribeBaseShape::it_provides_access_to_its_shadow[p:cxnSp/p:spPr]`
corresponds to the two original namespace cases. Placeholder source-member
obligations include `BaseShape.placeholder_format`, `_PlaceholderFormat.idx` and
`_PlaceholderFormat.type`; their defaults and absence error are covered explicitly,
including inherited Connector entries without dedicated upstream tests.

TDD: all six new tests failed before implementation because the two getters were
absent. Focused validation passed 35 tests across connector public surface, model
and domain files. Coordinating delivery records the maintained package checks.

Maintained validation: `npm run test:unit --workspace=pptx` passed 206 files / 5,936 tests; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. Built workspace-package consumer verified async factory/save and live property/canvas round trip. These are local workspace checks, not publication or whole-public-API certification.
