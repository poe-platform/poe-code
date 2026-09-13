# Drawing adaptation receipt

This is research/provenance, not product branding. The pinned source and standalone MIT notice are recorded in [the test audit](upstream-test-audit.md) and [the API audit](upstream-api-audit.md). No reference fixture or executable source is shipped by this change. Original TypeScript test wording, authored XML and independent numeric/XML expectations replace runtime mocks. Retain the existing standalone notices for historical derived research material.

[The case ledger](drawing-case-map.json) retains every selected parameter variant and expanded scenario independently. Its scope includes all DrawingML color/fill/line/effect units, XML color units, hexadecimal validation and owner access tests. This includes chart/table/background/font ownership obligations even where the bounded shape implementation cannot satisfy them. Chart line-series construction, chart gridline membership and paragraph line spacing are different features; a text match on “line” does not make them drawing-line-format tests.

[The API ledger](drawing-api-map.json) includes all DrawingML classes, enum values/helpers and inherited owner fill/line/shadow/color accessors. `_GradientStop` and `_GradientStops` remain public obligations. Missing owner construction or enum metadata is not an architecture-only waiver. New tests supplement missing source coverage for alpha, coercion, finite bounds, unknown nested effects, namespace lookalikes and exact XML preservation.

The older audit status saying adaptation has not started describes its historical checkpoint. This additive receipt records only this bounded change and does not rewrite unrelated inventories as implemented.

JavaScript and security mappings are precise:

- Model properties keep neutral snake_case; typed operations use camelCase JSON. In-memory model edits are synchronous; package loading/publication and explicit admitted I/O are async.
- Local fill absence is `null` in `FillFormat.type`; explicit no-fill is numeric `MSO_FILL.BACKGROUND` (5). Operation records distinguish `inherit` and `none`.
- Model angles are counterclockwise degrees, mapped to clockwise 60,000ths of a degree in XML; operation angles are clockwise degrees. Wrapping occurs modulo 360, including negative values. Path-gradient angle access is unsupported.
- Color `rgb` requires an existing sRGB representation; `theme_color` fails on missing color and returns `NOT_THEME_COLOR` on existing non-theme representations. No system/HSL/scRGB/preset sampling is implied. New RGB values require exactly six hexadecimal digits; invalid suffix parsing from the source is deliberately not mirrored.
- Brightness is finite in [-1,1], alpha/stop positions finite in [0,1]. No string/boolean coercion is permitted. Lengths use explicit units and the shared finite safe-integer conversion contract.
- Model numeric enum symbols remain separate from operation XML tokens. `PERCENT_40` corrects the documented source spelling drift; the typo is not a product alias. Return-only mixed sentinels have no editable XML token.
- Collections use `.length`, iteration and checked `.at(index)`. Any missing inherited `includes`, `count`, `index`, `reversed`, equality, owner/element view or bounds behavior remains an explicit API obligation, not a name-based exclusion.
- Picture fills reference an existing owner relationship or admit PNG/JPEG bytes through `mutateDrawing(..., { image: BinaryInput })` / `--file PATH` and explicit context. Structural admission does not claim complete decoding or CRC validation. There is no implicit filesystem/network/native/runtime authority. Complex effects and 3D payloads retain their XML; edits that would discard unsupported payload fail with `unsupported-edit`.
- Public XML exposure is bounded to the package XML representation. It does not mirror an unrestricted XML library, XPath evaluation or host filesystem access.

Procedures and corpus QA evidence live only in [the drawing QA plan](../plans/pptx-drawing-qa.md). Real publisher files remain disposable cache inputs from the manifest and never become unit dependencies.
