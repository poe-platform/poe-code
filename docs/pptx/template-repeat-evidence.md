# Template repeat research and contract mapping

This receipt covers designated slide graph repetition and literal per-record
bindings. Verification belongs to the implementation receipt; this research alone
claims no passing implementation, visual fidelity or whole-public-API parity.

The [format specification](../specs/pptx.md), [shared command contract](../specs/office-cli.md)
and [shared SDK contract](../specs/office-sdk.md) govern this surface. The
[test audit](upstream-test-audit.md) and [API audit](upstream-api-audit.md) record a
pinned historical baseline, not current package-wide implementation status.

The [case map](template-repeat-case-map.json) reviews the 2,700 unit variants,
973 expanded BDD examples and 2,407 API inventory records. No direct repeated-slide
binding operation exists in that baseline. Eleven lexical unit candidates and one
BDD candidate have exact inventory pointers and individual dispositions. This
includes both chart-series clone parameters and all four clonable-placeholder
parameters; none is silently merged into a passing repeat case. The BDD
`template_name` field is expansion metadata, not evidence of template binding.

The existing slide-copy, removal, text, table, image, notes, animation and chart
ledgers retain their exact parameter/example identities and partial or deferred
obligations. Repetition composes graph copying with bindings, so it adds independent
ordering, ownership, isolation, limit and atomicity assertions. It does not turn
preservation into chart-editing parity, note access into creating-getter parity,
or ordinary operations into a complete live object model. Inherited members,
underscore-prefixed returned interfaces, enums, collections, helpers and APIs
without source tests remain in the whole-public-API ledger.

## JavaScript and security mappings

| Concern | Exact mapping |
| --- | --- |
| Public surface | `applyTemplateRepeat(input, options, context)` is always async and returns the operation result containing output bytes. CLI `template apply` invokes the same bounded domain behavior with `kind: "repeat"` JSON. `affected` counts removed prototypes, inserted slides and bound occurrences; locations identify final instances/bound objects, or removed prototypes for zero records. Neutral model member spellings remain unchanged. |
| Options | Required fields are `kind: "repeat"`, `slides`, `records` and `mediaPolicy`. Records are arrays of existing typed `TemplateBinding` values. The operation is closed data; unknown keys, getters and other non-JSON values are rejected. Request data is captured before asynchronous admission. |
| Coordinates | `slides` and each binding's `slide` refer to explicit positive one-based positions in the original input. They are operation coordinates, distinct from zero-based live-model collections. A binding must address a designated prototype. |
| Ordering | Replace selected prototypes at their first source-list position. Emit record order first and requested `slides` order second. Preserve the relative order and IDs of unselected slides. Empty records removes the selected prototypes; it is an explicit mutation. |
| IDs and ownership | Deterministic graph remapping gives each copied slide and owned dependencies valid identities. Relationship IDs remain owner-local, shape IDs drawing-local. Preserve graph links and supported timing references with the owning instance. No randomness or clock is consulted. |
| Media | `shared-media` retains unchanged image/audio/video resources; `isolated-instance` copies those resources per copied slide dependency graph. Layouts, masters and themes remain shared under both policies; notes, charts and embedded chart workbooks are copied. Image binding keeps its existing occurrence replacement semantics and cannot silently mutate another instance's selected occurrence. |
| Bindings | Literal exact names, explicit slide scope and `one`/`all` cardinality. Text remains case-sensitive with no normalization or rescanning inserted values. Tables retain fixed unmerged grids; images supply admitted integer byte arrays and media type. Empty text/cells are values; null is not a missing-value shortcut. |
| Budgets | At most 1,000 selected slides, 1,000 records and 1,000 bindings in aggregate; expanded slide count also respects the explicit part limit. UTF-8 text/table and image payloads share the byte budget. Intermediate/final packages obey archive/XML/graph limits. Per-record admission alone is insufficient. |
| Failure | Validate and mutate in isolation; a failure in any later record yields no published result and leaves input bytes and the CLI destination unchanged. Dry-run validates without publication. Cancellation and limits retain their common error categories. |
| Authority | Bytes or explicit context capabilities only. Image bindings contain no path/URL lookup. No expression evaluator, dynamic method/property invocation, network, native runtime, host font discovery or implicit host I/O. |
| CLI | Common version-1 `template.apply` result envelope, deterministic JSON order and schema/capabilities description. Success 0; semantic/unsupported/selection failures 1; usage/schema 2; I/O/publication 3; limits 4; cancellation 130. |

## Documentation reconciliation

[The earlier binding receipt](template-bindings-evidence.md) and
[its usage guide](template-bindings-usage.md) describe the prior array-only
checkpoint. Their statement that repeated slides are outstanding is historical
for that checkpoint. Repeat adds an explicit discriminated object; the existing
array form continues to bind without repetition. It does not broaden text,
table or image payload behavior, introduce expression evaluation, or infer media
sharing. Draft examples are in [template-repeat usage](template-repeat-usage.md).
No README is changed.

The optional fourth `selectedSlides` parameter on the low-level
`applyTemplateBindings` function validates all specified prototype slots using
the same parser as ordinary bindings, including an empty binding array. It is a
stored array of distinct positive positions with a 1,000-item bound and defaults
to `[]`. Plain-array CLI scope is unchanged; repeat JSON provides the explicit
all-prototype validation route. `duplicateSlides.mediaPolicy` and
`slides duplicate --media-policy` expose matching optional copy policies, defaulting
to shared media; repeat still requires its policy explicitly.

Original acceptance evidence is in `template-repeat.test.ts`,
`slide-copy-media-policy.test.ts`, `command-template.test.ts`,
`command-slide-copy.test.ts` and the safe-bash `template-repeat.test.ts` suite.
The tests independently assert order/IDs, note backlinks, chart/workbook/media
ownership, cross-prototype links, timing targets and atomic errors. The paragraph
boundary, cross-prototype target and policy-snapshot regressions were observed
failing before their fixes. Final maintained validation belongs to
[the implementation plan](../plans/pptx-template-repeat.md).

The [corpus manifest](corpus-manifest.json) contains 14 disposable documents and
records SHA-256 identities and retention constraints. Its acquisition/census
limits are not product defaults. No downloads, fixture copying or corpus execution
were performed for this research. No renderer or native runtime was invoked.
Any later corpus exercise must use an agent procedure under `docs/plans` and
reduce meaningful findings to small original unit cases. Structural assertions
alone do not prove rendered appearance.

The existing [standalone MIT notice](upstream-license-notice.txt) and
[test-accounting notice](test-case-map-notice.txt) remain applicable to research
provenance. This receipt and examples use original wording and contain no derived
product code or assets.
