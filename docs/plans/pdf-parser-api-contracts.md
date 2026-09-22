# Private PDF engine contracts and dependent-command gates

Status: contracts increment implemented; mature parser and consumer qualification
remain incomplete. This receipt describes the working tree, not a release.

## Contract ownership

The existing `packages/pdf-parser` owns syntax, revision/object access, stream
decoding, page inventories, explicit security capabilities and draft extraction.
It remains private, separate from `packages/pdf`, with zero declared runtime
dependencies. This increment preserves those implementations and adds
`pdfCapabilities`, `getPdfCommandGate` and their exported types in that owner.
No upstream implementation or licensed asset was adapted or added.

The frozen matrix records candidate-local evidence independently for syntax,
recovery, inspection, cross references, revisions, filtered indexes, codecs,
security primitives, encrypted interpretation, pages, fonts, text, layout,
rewriting and consumer artifacts. Upstream source controls are research, not
candidate qualification. `local` is explicitly insufficient for the full
dependent-command profiles. All three command decisions are currently blocked;
qpdf separately requires lossless rewriting. No caller-supplied qualification
override is accepted. Cancellation reasons propagate unchanged.

The README specifies parse/extract interfaces, ownership, source locations,
limits, errors, recovery and the capability matrix. Existing pdftotext admission
exports still refuse extraction. No pdfinfo/qpdf handler or parser-consuming
Safe Bash export is added. Future CLI and SDK integrations must share the gate
and source-bundle the reviewed first-party closure through the maintained
private command boundary. The requested command package pattern is preserved at
`docs/plans/archive/safe-bash-command-package-pattern.md` after its existing move;
this task does not restore or overwrite the moved document.

## Executed controls

TDD: the new workspace test first failed because the contract exports did not
exist, while the existing 156 controls passed. After implementation, the
workspace suite passed 163 tests with zero failures, skips or cancellations:
four gate controls and three consumer controls were added.

Consumer controls use esbuild only as development tooling, write no artifacts,
retain every portable engine export in the bundle, and verify the complete
metafile contains only first-party parser source and no external imports or Node
crypto entry. Node/browser/workerd conditions each execute the resulting bundle
in an isolated Node VM realm without process, Buffer, require, files or network
capabilities. Exact string/raw bytes, unchanged input, blocked rewriting and
falsey cancellation survive these realms. These controls establish conditional
source-graph portability, **not actual browser/workerd runtime acceptance or
Safe Bash installed-artifact qualification**.

Maintained routes: `npm run test --workspace=pdf-parser`,
`npm run lint --workspace=pdf-parser` (including source/test typechecks),
`npm run build:workspaces -- --workspace=pdf-parser` (runtime/declaration emit),
and `npm run lint:packages` passed. Package lint reported all 18 rules passing.
An additional in-memory TypeScript consumer successfully checked the emitted
declarations under strict NodeNext, exact optional properties and unchecked
indexed access, using the parse/object/page/extract and gate interfaces. Direct
Node ESM imports of the emitted artifact passed byte and gate checks. Neither
check created fixture files. `git diff --check` passed.
No visual CLI behavior changed; screenshots were not required for this API
increment. No native oracle or LLM was invoked. No temporary evidence files
were created. No local commit, remote-main delivery or release is claimed.

## Remaining acceptance plan

1. Complete the independent mature feature cells in
   `pdf-parser-qualification.md`, retaining strict/recovery/inspection/extraction
   distinctions and original byte/mapping/geometry provenance. Missing codecs,
   filtered indexes and encrypted document interpretation stay explicit gates.
2. Qualify each proposed command profile before implementing extraction exports;
   do not use header-version acceptance as PDF 1.0–2.0 feature evidence.
3. Review and admit the parser declaration closure to the maintained private
   consumer build boundary, source-bundle required portable modules and retain
   licenses. Check actual packed manifests/imports/assets, not just workspace
   dependencies. Never include the opt-in Node crypto entry in portable graphs.
4. Execute strict installed declaration consumers and Node, actual browser and
   actual workerd runtime cells against those exact artifacts, including realm
   ownership, budgets, cancellation, host isolation and replay controls. Current
   VM controls do not discharge these cells.
5. Qualify a writer with graph-aware lossless round trips before any qpdf
   transformation. Raw inspection APIs alone cannot close this gate.

Pinned source research and compatible-copy restrictions remain in
`safe-bash-pdf-parser-research.md` and `safe-bash-pdf-parser.md`. No external
parser adoption is proposed; no dependency permission request is needed for
this original first-party contract increment.
