# Typed template bindings evidence

Scope: original, bounded text/table/image binding composition. F57 repeated slides
and whole-model API conformance remain outstanding. This receipt does not change
the historical inventories or count adjacent functionality as binding parity.

## Pinned test and API accounting

Reviewed [test audit](upstream-test-audit.md), all inventory row identities in
[unit/expanded BDD inventory](upstream-test-inventory.json), [API audit](upstream-api-audit.md)
and reconciled [public API inventory](upstream-api-inventory.json), pinned to
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. No direct template data binding API or
parametrized/BDD binding scenario was identified. There are zero newly claimed
upstream parity rows for this operation.

The exact name-search candidates are accounted for below. BDD `template_name` is
scenario-expansion metadata present on every row, not a template-binding feature;
searching that field as a feature would wrongly classify all 973 scenarios.

| Candidate identity | Disposition |
| --- | --- |
| `tests/test_api.py::DescribePresentation::it_opens_default_template_on_no_path_provided` | Default deck creation, not data bindings; retained in the full ledger. |
| `tests/text/test_fonts.py::Describe_Stream::it_can_read_fields_from_a_template` | Binary font-record decoding, not text interpolation; retained in the full ledger. |
| `features/prs-default-template.feature:6`, `Create a minimal presentation from the default template` | Default deck creation, not a data binding BDD workflow; retained in the full ledger. |

Component behavior keeps its exact parameter/example identities in existing
research ledgers. This many-to-one composition reuses those components; it does
not transform their deferred live-model obligations into passing binding cases.

| Dependency and retained ledger | Accounting boundary |
| --- | --- |
| [Literal replacement](text-replacement-accounting.json) | 49 unit variants, 23 expanded BDD cases and 20 API records; formatting-preserving literal replacement has no direct source equivalent. Destructive `.text` setters remain distinct. |
| [Table grid/formatting](tables-case-map.json) | 171 unit variants and 41 expanded BDD cases, including partial/deferred members. Binding updates existing cell text, not full live table/placeholder parity. |
| [Image occurrence replacement](image-replacement-case-map.json) | 84 unit variants and 41 expanded BDD cases, retaining the complete insertion baseline and adjacent placeholder variants; no direct replacement API exists in the baseline. |
| [Whole-public-API ledger](public-api-map.json) and [full test ledger](test-case-map.json) | Inherited members, enums, helpers, collections, underscore-prefixed returned interfaces and APIs without tests retain their obligations unchanged. |

The existing standalone [MIT notice](upstream-license-notice.txt) and
[test accounting notice](test-case-map-notice.txt) remain. Bindings source, tests,
JSON examples and assets are original; no source fixture or implementation was
copied into this improvement.

## Exact JavaScript and security mapping

| Contract | Mapping |
| --- | --- |
| Operation versus object model | `applyTemplateBindings(input, bindings, context)` is an async operation, exposed as `template.apply`; it does not rename neutral live-model methods or add a generic member evaluator. |
| Data structure | Readonly discriminated array with `kind: text | table | image`; required `name`, `scope: slides`, one-based `slide`, and `cardinality: one | all`. Payload is exactly `text`, `table`, or `image`, respectively. |
| Text | Exact UTF-16 string matching without normalization, regex, expression syntax or property traversal. Valid Unicode sequences round-trip. Only original literal `{{name}}` slots are substituted; replacement text is not parsed again. |
| Absence | Missing fields and unknown fields fail. Empty text/cells are values; `null` and `undefined` do not substitute for required data. Empty bindings return identical bytes. |
| Cardinality/ownership | Declaration identity is kind/name/slide; repeated names on separate slides are independent. `one` requires one slot, `all` admits repetition within its explicitly selected slide. Other scopes remain untouched. |
| Tables | Rectangular `string[][]` replaces existing unmerged fixed-grid cell content with one paragraph of ordinary runs per cell; multiple paragraphs, fields, breaks and equations are rejected. No coercion of objects, arrays, numbers or booleans to strings. |
| Images | Literal byte array plus explicit media type; no embedded path/URL descriptors, implicit VFS read, external fetch, image execution or native decoder. Occurrence replacement retains shared-resource isolation. |
| Validation/publication | Validate schema, targets, required slots, cardinality and payload admission before any result publication. Errors retain the versioned shared envelope and neutral category; CLI maps usage/schema to 2, semantic validation to 1, I/O to 3, limits to 4 and cancellation to 130. |
| Execution authority | No eval, Function construction, script engine, arbitrary expressions, host I/O, runtime process, network, clocks or inferred identity. Context supplies explicit capabilities. |

## Documentation drift resolution

The former loose `Bindings` shape allowed mismatched payload combinations,
missing scope/cardinality and a proposed `repeat-slides` variant. The bounded
schema closes each variant, requires explicit selection and only admits the three
implemented payload families. Repeated slides remain visibly required by F57 and
are rejected by this bounded surface; this is not full F57 completion.

Specification status and implemented-through metadata remain proposed. Audit
historical “not implemented” statements describe their original checkpoint;
this bounded receipt does not claim repository-wide implementation. README files
are unchanged; usage remains in [the draft guide](template-bindings-usage.md).

## Verification receipt

Original SDK and CLI assertions and maintained checks are recorded after execution.
No reference runtime or network acquisition is needed for these cases. Corpus QA
follows [the agent procedure](../plans/pptx-template-bindings.md); no corpus bytes
are shipped or made unit-test dependencies.

Disposable structural QA executed against the already cached manifest entry
`.cache/pptx-corpus/IXPE-Presentation-Template.pptx`, SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
The hash matched before admission. Empty bindings returned identical source
bytes. The first slide contained empty placeholders, so the first ordinary text
run on slide 2 was used for an original in-memory marker. Binding it to
`海 😀 {literal}` yielded one affected slot; independent decoded XML contained
that exact text and all 37 untargeted part payloads matched the admitted source.
No files were written, corpus originals changed, downloads performed or native
renderers invoked. This is structural preservation evidence, not a rendering or
visual-fidelity claim. No meaningful QA defect needed regression reduction.

The specification checker passed with zero warnings. Owned-document whitespace
checks passed. Final staged-package verification passed all 4,302 tests in 172
files and the maintained lint/typechecks. The selected workspace build completed
its three declared builds, four Shell/SDK acceptance cases passed after rebuild,
and all 107 staged registry checks passed. Help and dry-run output screenshots
were inspected. The [integration receipt](../plans/pptx-template-bindings-command.md)
records the isolated staged-package procedure and separate failures in unowned
uncommitted sanitization work; this is not a clean whole-workspace claim.
