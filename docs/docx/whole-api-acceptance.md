# DOCX whole-public-API acceptance evidence

Status: **Blocked; partial behavior verified.** This does not complete
`whole-api-acceptance` or any later task.

The [row review](whole-api-acceptance.json) retains the complete 1,337-row
[public API map](public-api-map.json), all 920 reconciled inventory records,
262 enum values, inherited/returned interfaces and publicly documented
underscore-prefixed types. The original 1,609 unit variants and 650 BDD examples
remain historical source evidence. No denominator is replaced by the implemented
subset or by the cases with upstream tests.

## Failed acceptance prerequisites

The actual public barrel was bundled in memory for browser/worker conditions,
with zero external imports. Its `Document` factory is absent. Paragraph, Run,
Table, cell/row/column owners, Sections/Section, headers/footers, Comment/Comments,
CoreProperties, Drawing and other required public owners are also absent.
Their utility routes are not live object-model implementations. The later
[collection/value increment](collections-values.md) verifies direct enum object
protocols, including `WD_UNDERLINE.fromValue`, over the existing live/value types.
That bounded evidence supersedes the earlier enum-protocol absence finding; it
does not close the missing-owner prerequisites. The JSON row review retains its
audit-time observations rather than representing current enum availability.

Ten model workflow rows cannot enter their required public-factory path. Their
workflow bodies were not executed, and unavailable workflows are not passing
tests. The finite style-identification workflow has partial evidence; complete
guide headings, legacy-ID fallback, dangling application and general Document
ownership remain unqualified. All twelve guide files remain accounted for,
including the installation documentation-error disposition.

## Original regression and bounded execution

The new original memfs test
`packages/docx/src/guide-style-identification.test.ts` authored a small document
and stored style, then read name, ID and enum type through public synchronous
model properties, the async SDK batch and the CLI command engine. It checks
identical results, pure version-1 JSON, empty diagnostics, zero publication and
unchanged input. CLI dry-run explicitly authorizes a getter that may create
missing definitions; this does not change ordinary noncreating utility reads.

The first test failed: an existing-definition SDK read reported `affected: 1`
instead of zero. Batch accounting used possible getter side effects rather than
actual materialization. The fix tracks internal style-store revisions and
attributes initial styles-part creation once to its bootstrap getter. A second
original failing variant caught operation-order dependence when a point value
preceded bootstrap. Both failures were observed before their corresponding code
corrections. Creation/reopening controls retain styles/latent creation counts
while repeated existing-definition reads count zero.

This internal accounting adds no public method or host authority. Mutation
setters/calls keep their existing target-count semantics. Creating-getter
schema/publication requirements remain intact.

## Exact bounded mappings and documentary corrections

- Model member spellings remain neutral snake_case; typed operation options
  remain camelCase. The review links actual `.get`, `.set` and `.call` schema IDs
  instead of treating proposed bare IDs as executable routes.
- Inherited style `name` and `style_id` declarations admit null reads/resets.
  Their getter/setter types and proposed batch form types are reconciled.
- Standalone Image is immutable admitted metadata. Its always-async factories
  use ImageModelInput/ImageModelContext; native dimensions return Length values,
  and scaled dimensions also admit strict declarative DocxLength values.
- Frozen enum symbols preserve `{enum,name}` JSON and expose direct numeric,
  string and XML metadata. Families now provide `fromValue`, `from_xml`,
  `to_xml`, immutable name-keyed `.members` and canonical iteration, alongside
  the existing helpers and typed batch routes. Original tests verify 19 families,
  262 named values and 11 family aliases. Exact sentinel, null, alias and
  transport-security mappings are recorded in the collection/value evidence;
  these protocols do not establish whole-object-graph acceptance.
- The shared capability, ownership, null/undefined, UTC date, exact unit and
  half-away rounding requirements remain authoritative. Scoped original test
  links do not qualify missing Run/Paragraph/Document owner bindings.

The [owned plan](../plans/docx-whole-api-acceptance.md) contains the executed
agent QA procedure and maintained-check receipts. Research and legal notices
retain provenance; no reference-project identity enters new product code,
comments, tests, fixtures or CLI output. No README, publisher document,
reference binary, corpus cleanup, push or release is part of this result.
