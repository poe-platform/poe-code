# Opaque media in slide lifecycle operations

The isolated-instance branch of `duplicateSlides` previously classified every
`+xml` media type as presentation XML. An original empty SVG containing an opaque
metadata record reproduced `unsupported-edit` through both SDK and command engine.
Media parts now remain inert bytes; presentation, notes and chart XML still use
the existing identity remapping. Media with outgoing relationships remains rejected.

## Public behavior and language/security mappings

`duplicateSlides(input, { selection, position, mediaPolicy }, context)` always
returns `Promise<Uint8Array>`. Explicit byte/stream/VFS authority and resource limits
remain required. `slides duplicate --media-policy isolated-instance` uses the same
engine; the omitted/default policy shares media. CLI slide positions are one-based;
structured selectors retain their declared coordinate system and owner identity.
There is no new object-model spelling, alias, arbitrary method evaluator, native
runtime, ambient filesystem access, network, SVG evaluation or rendering.

The change preserves admitted SVG media; it does not implement SVG insertion,
fallback generation, or remapping of unknown DrawingML extensions. Unsupported
extension references still reject before publication. Removing a copied slide
retains orphan media under the existing conservative deletion policy; it removes
the slide and its relationship part, not general unreferenced resources.

## Original assertions

- `packages/pptx/src/slide-copy-svg-media.test.ts`: five cases, including both
  policies, independently parsed media targets, original-byte preservation,
  deterministic copy bytes, duplicate/delete, command publication, no-op,
  target-only rename/reorder and unsafe outgoing media relationships.
- `packages/safe-bash/tests/commands/pptx/slide-lifecycle-invariants.test.ts`:
  independent hand-authored package graph, exact slide IDs and part sets, SHA-256
  comparisons, actual Shell invocation, SDK/CLI parity, opaque extension retention
  on rename/reorder and refusal on unsupported copy.

Expected graph values are literal authored values. Equality with SDK output is
additional adapter evidence, not the graph oracle. All fixtures are small original
in-memory assets; tests neither download documents nor write host files.

## Case/API accounting and drift

The canonical inventories retain 2,700 unit variants, 973 expanded BDD examples
and 2,409 API records. Their historical implementation labels are not a current
coverage certificate. This follow-up does not overwrite those labels or exclude
inherited, underscore-prefixed, helper, enum or untested public members.

All pointers in these adjacent ledgers were resolved against retained inventory:

| Ledger | Exact case rows | API rows | Scope of this follow-up |
| --- | ---: | ---: | --- |
| [Slide copy](slide-copy-case-accounting.json) | 18 | 0 | Supplemental preservation regression; no source whole-slide duplicate API/test exists in this ledger. |
| [Slide order](slide-order-case-accounting.json) | 34 | 93 | Additional stable-ID/label/order evidence; broader live-member obligations keep their existing dispositions. |
| [Slide removal](slide-removal-case-accounting.json) | 124 | 51 | Additional retained-resource/deleted-slide evidence; no general garbage collection or action-model parity claim. |

These are existing exact parameter/BDD ledgers, not newly implemented case totals.
No canonical test or API identity mentions SVG. The new XML-media test is an
additive format/security regression, not a substitution for a source parameter.
The copied-media operation does not change documented neutral model members.
Existing standalone legal notices remain retained; no source implementation or
reference fixture was copied into this change.

## Disposable QA boundary

The manifest-listed cached `data-visualization-course.pptx` was checked against
SHA-256 `ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`.
Independent ZIP/XML inventory found four SVG media parts used by slides 36 and 39.
Both isolated-instance copy attempts rejected with `unsupported-edit` under
explicit 128 MiB input/member, 256 MiB expanded, 5,000-part and 20,000-relationship
ceilings. An initial smaller member ceiling produced `resource-limit`.
No output deck was published. These conservative rejections do not establish
successful real-world SVG fallback copying or application rendering fidelity.

Maintained commands and final check results are recorded in the
[integration plan](../plans/pptx-slide-media-lifecycle-integration.md).
