# Advanced chart corpus verification

Root owns this procedure and its receipt. Use the existing chart-bearing fixture
listed in `docs/pptx/corpus-manifest.json`; require exact SHA-256 before reading
parts. It is disposable QA material and must never be staged or used by unit
tests. No downloads, native renderer, pipeline execution or product network.

1. Independently inspect the ZIP and count chart families and extension resources.
2. Through the built public SDK, read charts and make an unrelated slide text
   edit using explicit supplied bytes and limits.
3. Compare every chart, chart relationship and embedded resource part's SHA-256
   with its input counterpart; confirm the input archive hash is unchanged.
4. Attempt selected slide import only when its full dependency graph is supported.
   Record unsupported structures as limitations, never passes or silent omissions.
5. Reduce any meaningful mismatch to an original in-memory regression before
   changing product code. Record execution below without committing QA artifacts.

## Execution receipt

The existing `data-visualization-course.pptx` cache fixture matched its manifest
SHA-256 `ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`
and 52,907,926-byte size. Independent central-directory parsing and bounded raw
inflation found eight chart roots, eight styles, eight color styles and eight
chart relationship parts. The archive also contains eight embedded resources.

The built public SDK returned eight chart occurrences: seven classic plots
(four bar, one line, one pie and one scatter) and one extended chart with no
classic plot projection. `replacePresentationText` changed one slide-local text
match. All 40 chart/relationship/embedded resource parts retained their exact
SHA-256 values; the input archive hash remained unchanged. The output contained
52,907,910 bytes. This run used the built SDK before the import improvement;
it verifies existing unrelated-edit preservation, not the new import behavior.

No QA artifacts were written and no visual rendering was performed. Full-deck
import was not attempted: this fixture contains additional table, MCE, timing
and other dependency structures outside this bounded import change. Original
SDK and CLI fixtures exercise the safe chart dependency closure separately.
