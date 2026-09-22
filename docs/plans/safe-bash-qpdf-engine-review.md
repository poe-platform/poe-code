# engine-qpdf task review

Reviewed 2026-09-21 at HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, including the existing working tree. Completion is blocked. This review preserves other contributors' files and does not change implementation status in their plan.

## Unresolved findings

1. **Missing prerequisite parser.** `packages/pdf/src/index.ts` exports layout rendering, not raw-object or revision APIs. The shared parser plan's `pdf-byte-syntax`, `pdf-revisions`, and `pdf-parser-api` tasks remain open. Package source inspection found no shared PDF parser implementation. The requested engine cannot consume the required API yet; a command-local replacement would duplicate the planned shared engine.
2. **No qualified lossless writer.** `packages/pdf/src/serialization.ts` explicitly requires contiguous generation-zero identities, rejects trailer IDs/encryption, and constructs only Root/Info trailer entries. Its import and the PDF package manifest depend on external runtime libraries. Reusing it would fail generation/remapping, unknown-trailer preservation and zero-dependency requirements. These restrictions are appropriate to its existing layout scope; this review does not change that renderer.
3. **No command or installed export.** A direct existence check and parsed safe-bash manifest confirmed that `packages/safe-bash-command-qpdf`, `./commands/qpdf`, and a `safe-bash-command-qpdf` dependency are absent. Consequently there is no engine implementation diff to simplify or qualify for cancellation, cleanup, budgets, ownership, CLI/SDK parity, snapshot compatibility, or installed declaration bundling. These gates remain unexecuted, rather than passing by absence.
4. **Completion status conflicts with evidence.** The existing diff in `docs/plans/safe-bash-qpdf.md` changes `engine-qpdf`'s `implement` status from `open` to `done`. No implementation supports that status; `safe-bash-qpdf-engine-prerequisites.md` already records the missing prerequisites. The existing plan edit is preserved, but its completion claim cannot be accepted.

The requested package-pattern document has moved in existing edits. This review read `docs/plans/archive/safe-bash-command-package-pattern.md`; it requires real implementations rather than empty scaffolds, a shared parser owner, and installed private-workspace bundling qualification.

## Verification and next gate

`npm run test:unit --workspace=@poe-code/pdf` passed all 49 tests in six files, including the five serializer tests. These verify the current renderer's maintained scope; they do not qualify qpdf rewriting or the missing parser. No new code was written, so no engine TDD cycle is claimed. No native controls were rerun, visual behavior changed, packages published, commits created, pushes made, or releases verified.

Before implementation can proceed, the shared parser must expose and qualify its raw-byte/object/generation/revision contract. Then write original failing writer tests against that actual API for generation handling, remapping, shared references, incremental replacement/free entries, unknown extension dictionaries/streams/trailer references, and reachability policy. The writer and command require their own cancellation, budget, VFS publication and installed-artifact checks. Keep all unexecuted acceptance cells open; the supplied pinned native observations remain compatibility evidence only.
