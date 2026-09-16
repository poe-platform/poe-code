# Advanced chart preservation and import

This bounded change fixes import rejection for safe chart resource graphs. It does not introduce chart semantic editing or complete the public model SDK.

## Draft usage

`importSlides(destinationBytes, sourceBytes, { sourceSlides: [1] }, context)` now preserves classic combination/3D charts, trendlines, error bars, chartEx, and recognized chart style/color resources when the graph satisfies the safety boundary below. CLI `pptx slides import destination.pptx --source source.pptx --source-slides '[1]' --output combined.pptx` uses the same operation. The existing import command schema still accurately rejects **unknown extension references**; it does not claim to reject every extension.

Chart-owned relationship IDs are local to their OPC part. Preserving them does not introduce an identity collision between source and destination. Import allocates destination part names and rewrites relationship targets while preserving the exact chart, chart style, chart color style and embedded workbook bytes. SHA-256 assertions cover both imported resources and unmodified destination resources. Source bytes remain unchanged. SDK inventory must still discover the imported chart from its slide graphic frame.

## Safety boundary

Recognized content types are classic DrawingML charts, chartEx, chart style and chart color style. Their XML root namespace and local name must agree with the content type. Supported opaque XML namespaces are the source document's chart and DrawingML dialects, chartEx (2014), chart style (2012), and chart extension (2007/8/2). No unknown namespace is treated as safe merely because its markup can be parsed.

Allowed relationships owned by these resources are embedded workbooks, images, chart styles/colors and theme overrides, subject to existing content-type and binary-leaf checks. Embedded workbook edges are limited to actual chart owners. XML relationship attributes `id`, `embed` and `link` must resolve within the owning part. Existing media rules retain external image target text without fetching it. Other external chart resources, unknown relationship types, opaque global/presentation references, foreign attributes, `xml:base`, malformed root identities, and unknown extension namespaces fail with `unsupported-edit` before returning output. Known path/shape/slide reference attributes and DrawingML hyperlink structures are rejected. AlternateContent and newer extension namespaces remain outside this import subset.

Unrelated text edits already preserve arbitrary opaque chart parts and relationship/resource bytes without reading or rebuilding chart semantics. That broader preservation property does not imply that every opaque graph can safely be imported under new part names.

## Unsupported editing inventory

| Structure | Preservation | Semantic editing |
| --- | --- | --- |
| Combination and general 3D charts | Unrelated edits; bounded import above | Creation/reconstruction remains unsupported |
| chartEx | Unrelated edits; bounded import above | Construction/data reconstruction remains unsupported |
| Trendlines and error bars | Exact containing-chart bytes on import | Rebuilding these structures remains unsupported |
| Recognized chart extension/style/color XML | Exact bytes and supported relationship closure | No new style/extension model setters |
| Unknown extensions or unsafe reference graphs | Unrelated edits preserve bytes | Import rejects; no silent downgrade |

Existing supported local scalar edits remain subject to their own preservation validation. This change does not withdraw documented public getters/setters or mark underscore-prefixed types private; unimplemented object-model obligations remain explicit in the retained API inventory.

## Original tests and provenance accounting

The new `advanced-chart-import.test.ts` has independently authored XML and binary placeholders, memfs-backed input staging, independently parsed relationship target assertions, exact SHA-256 checks and SDK inventory assertions. No reference fixture, source body or product name was copied; existing standalone MIT notices remain unchanged.

The consulted [test audit](upstream-test-audit.md), [test inventory](upstream-test-inventory.json), [API audit](upstream-api-audit.md) and [API inventory](upstream-api-inventory.json) remain research provenance. [Chart inventory accounting](chart-inventory-case-map.json) retains **995 unit variants and 412 expanded BDD scenarios**, including their original parameter identities. [Chart expansion accounting](chart-expansion-case-map.json) retains all 1,407 rows and explicitly records outstanding cases. These rows are not promoted to completed adaptations by the new preservation tests. No upstream import scenario is claimed: the new safe-remapping/hash cases are additional original security and interoperability regressions.

The chart-part/workbook source family has nine retained unit variants. Reading a chart and its workbook relationship is partially exercised here through inventory and relationship closure; creation, workbook replacement and absent-workbook behavior retain their prior outstanding/partial status in the linked ledgers. Chart type/plot and BDD scenarios retain every expanded case in those ledgers; preserving chart XML is not an independent assertion of each chart's model API behavior.

## JavaScript and security mapping

The unchanged public entry point accepts explicit `BinaryInput` values and returns asynchronous `Uint8Array` output. Source slide selectors use one-based safe integers, existing options and dialect rules; no new options, aliases, enum substitutions or Python protocol emulation were introduced. Relationships use owner-scoped string IDs and content types, while exact payloads remain bytes. Unsupported remapping produces the existing typed `OfficeError` with code `unsupported-edit`, phase `validate-intent`; CLI maps it through the shared office failure contract. Package logic has no implicit host I/O, native runtime or network. Tests use opaque workbook bytes and do not execute or recalculate embedded content.

The [corpus manifest](corpus-manifest.json) was consulted as disposable QA provenance. No unit test loads the corpus or downloads data; no corpus asset is shipped. Execution procedures and final QA receipts belong in `docs/plans`.
