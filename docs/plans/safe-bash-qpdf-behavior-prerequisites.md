# behavior-qpdf prerequisite verification

Inspected 2026-09-21 at HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, including the working tree. Requested behavior is **not implemented**. All candidate acceptance cells remain OPEN.

## Validated current blockers

| Required boundary | Current evidence | Consequence |
| --- | --- | --- |
| Shared existing-document parser | Package TypeScript search for `parsePdf`, `parsePDF`, `PdfParser`, `PDFParser`, and `rawObjects` found no implementation. `packages/pdf/src/index.ts` exports layout rendering, not raw-object/revision parsing. `docs/plans/safe-bash-pdf-parser.md` leaves byte syntax, revisions, filters, page tree, security and parser API implementation open. | There is no actual shared parser API against which to write the requested transformation edge-case tests. |
| Qualified graph writer | `packages/pdf/src/serialization.ts` imports `pdf-lib`, rejects sparse identities and nonzero generations, rejects trailer Encrypt/ID, and serializes only Root/Info trailer entries. Its declared scope is classic xref with contiguous generation-zero identities. | It cannot qualify unknown trailer preservation, revision resolution, import/remapping, crypto, object streams or linearization. Its existing renderer scope is preserved. |
| Responsible package and installed export | Filesystem existence check returns false for `packages/safe-bash-command-qpdf`. Parsed `packages/safe-bash/package.json` has neither `./commands/qpdf` nor a `safe-bash-command-qpdf` dependency. | No command engine exists to compose or test through CLI/SDK or isolated installed consumers. |
| Engine completion claim | `docs/plans/safe-bash-qpdf.md` records engine implementation/refactor/test done, while `safe-bash-qpdf-engine-prerequisites.md` and `safe-bash-qpdf-engine-review.md` record the absent implementation. Current source checks confirm absence. | The status is not evidence of completed code. Preserve the unrelated plan edit; do not close dependent behavior gates. |

The requested package-pattern path was moved by unrelated edits. Its available [archived document](archive/safe-bash-command-package-pattern.md) says: “Do not create empty command scaffolds or mass-migrate existing commands.” It also places shared parsing in private engine packages and requires PDF parser qualification before lossless qpdf transformations. A command-local parser, external-library adapter, or unsupported-only placeholder would not satisfy those requirements. These are implementation prerequisites, not an approval requirement.

## First implementation increment after prerequisites

Use the real shared parser API, memory VFS and mocked explicit capabilities. Begin with failing tests for sparse/nonzero-generation references, incremental replacement/free entries, shared-resource aliasing and unknown reachable objects/streams/trailer keys. Check writer offsets, stream lengths and remapping independently. Preserve default reachable-graph versus explicit preserve-unreferenced semantics.

Then qualify page selection ranges and exclusions, repeated/imported pages and inheritance; metadata and page labels separately for primary/import/split; cancellation and input/decoded/retained/output/work/recursion quotas; and exclusive staging with identity-aware publication and collision-safe backups. Proceed through inspection/JSON, explicit bounded repair, compression, encryption and genuine two-pass linearization only as their independent checks pass. Keep unsupported crypt handlers, permissions and signature invalidation visible. The supplied native observations constrain expected behavior but do not qualify a first-party implementation.

Integrate only a real implementation as the private ESM `safe-bash-command-qpdf` workspace. Keep safe-bash composition-only, preserve canonical runtime identities, and prove bundled runtime/declarations through isolated installed consumers. Retain all 140 option inventory entries and all G01–G60 and O001–O140 cells in the existing acceptance matrix; none is closed by this inspection.

## Work and verification limits

Read-only source searches, serializer inspection, parser-plan status inspection and parsed manifest/existence checks were executed. No native oracle was rerun. No runtime changes or TDD cycle are claimed: a missing-module test would only demonstrate absence, not transformation behavior. No builds or unit checks were needed for this documentation-only change. No CLI visuals changed. No package was published, and no commit, push or release occurred. Unrelated edits were preserved; only this evidence document was added.
