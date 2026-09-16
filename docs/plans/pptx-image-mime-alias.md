# Imported JPEG MIME alias correction

The exact research BDD case `presentation-bdd-de957907b33b` requires access to
`Picture.image` after loading a package whose image content type is `image/jpg`.
Pinned source: `features/prs-open-save.feature:37` and
`features/steps/presentation.py:202` at presentation research commit
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be`. Inventory-only preservation did not
prove this behavior.

Original TDD reproduction: create a tiny JPEG presentation in memory, parse and
merge its content-type declaration to the known alias, then access the actual
loaded model's first Picture.image. Before the change this threw the typed
`unsupported-profile` error. The contradictory `image/png` declaration still
rejected. This is an actual public returned-interface gap, not decoder internals.

Fix ownership is limited to `Picture.image` in `slide-model.ts`: canonicalize
exactly `image/jpg` to `image/jpeg` when constructing the returned immutable value.
Continue strict JPEG byte admission and continue rejecting every unrelated
contradictory content-type declaration. Do not rewrite the package declaration.
Original ZIP entry payload assertions prove save preserves every part and the
original bytes; ZIP serializer version metadata itself may normalize.

CLI `images extract` already returns exact bytes via explicit capabilities. It
keeps `.bin` safe output naming for this noncanonical declared MIME; the test
asserts that deliberate existing mapping rather than claiming a `.jpg` name.
No CLI output/schema change, README, corpus fixture, native decoder or network
behavior is introduced. All test input bytes and wording are original.

Checks:

- Initial red public model regression: typed `unsupported-profile` from alias.
- Four original tests cover actual Image access/canonical metadata, unrelated
  contradictory declarations, alias-with-invalid-signature rejection, and CLI
  original-byte extraction through memfs.
- Focused image alias, returned media model and immutable Image tests: 24 passed.
- Scoped ESLint and test TypeScript compile passed; root coordinates maintained
  package checks before the atomic commit.

Commit candidate: `fix(pptx): access imported JPEG MIME aliases safely`.
Owned files: `packages/pptx/src/slide-model.ts`,
`packages/pptx/src/image-mime-alias.test.ts`, and this plan. Follow-up reconciliation
ledger correction belongs with the image accounting commit. No push or release.

Final root verification: maintained pptx workspace tests passed 6,654 cases in
250 files; workspace lint and selected workspace build closure passed. Five
focused actual safe-bash cases passed. Only explicitly owned files enter the
local atomic commit; no push or release.
