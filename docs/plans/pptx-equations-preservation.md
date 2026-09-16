# Equation preservation execution receipt

Scope: literal text replacement, run formatting/assignment, text frame and paragraph formatting, and slide duplicate/import. Authority: `docs/specs/pptx.md` F41, `docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, root AGENTS.md. No scoped AGENTS.md exists under packages/pptx.

1. Read the test/API audits and inventories and corpus manifest. The manifest's 20 mathematical objects use the drawing math wrapper; reduce that structural feature into original tiny XML, without copied text or downloaded unit inputs.
2. Reproduce issues before changing code. Original tests demonstrated hidden ignorable math allowed literal matching across a mathematical object, replacement modified a cached math fallback, slide duplicate/import rejected mathematical namespaces, and direct nonignorable math failed selection admission. Additional original tests demonstrated bulk run formatting modified equation fallback runs and targeted run text assignment modified their cache.
3. Admit only exact mathematical roots as opaque preservation elements. Do not declare their namespaces understood, so MCE fallback selection remains unchanged. Preserve mathematical subtrees byte-for-byte during adjacent replacement. Skip protected caches during bulk run formatting and reject explicit fallback run targeting with unsupported-edit. Copy known mathematical namespace structures and drawing wrappers while still inspecting relationship references and rejecting foreign extension structures that cannot be safely remapped.
4. Retain ordinary whole-frame destructive assignment but reject mathematical/fallback deletion through the shared frame primitive before mutation. This protects TextFrame.text, Shape.text, cell.text and exposed SDK/CLI frame text assignment. Paragraph.text and clear methods are absent rather than newly implemented. Track all three existing run assignment parameter variants and all five BDD setter variants, plus six whole-frame assignment variants and two frame BDD variants in `docs/pptx/equations-preservation-case-map.json`, retaining their independent original SDK/CLI scalar tests. Direct equation variants are absent in the source inventory; new equation tests are supplemental original acceptance cases.
5. Verify 21 original equation preservation cases, generic exact-root compatibility and attribute collision tests, and existing replacement/run/slide suites. Tests use caller-owned bytes and memfs; no unit fixture downloads, host I/O, renderer or evaluator. Maintained package lint and all unit checks are run by the parent before commit.

Observed focused results: 107 cases passed across equation preservation, compatibility, literal replacement, run SDK formatting and run text assignment before the whole-frame guard. Four further regressions reproduced silent math deletion; the shared frame guard makes these reject before publication or model mutation. Root owns final maintained checks and commit. No commits or pushes from this subtask.

Remaining scope limits: unsupported foreign mathematical extension namespaces or unresolved relationship references reject slide remapping; these remain opaque during supported adjacent text edits. Rendering and formula evaluation are excluded. This receipt does not claim whole-public-API parity or all source behavior implemented.

Final parent checks on frozen source: `npm run test:unit --workspace=pptx`
passed 135 files / 3733 cases. `npm run lint --workspace=pptx` passed ESLint and
source/test TypeScript checks. `npm run build:workspaces -- --workspace=pptx`
passed the maintained three-workspace dependency closure. Twenty-one new
preservation cases cover the final whole-frame guard as well as literal/run/slide
behavior. No push or release is part of this delivery.
