# Slide media lifecycle integration

This bounded follow-up checks F07 slide lifecycle and F34 opaque media retention.
It does not execute the whole pipeline or certify complete public API coverage.

## Ownership

- Domain worker owns `slide-copy.ts` and its new media regression.
- Adapter worker owns its new lifecycle acceptance test and CLI plan.
- Root coordinates checks, research receipt and explicit-file local commit.

Preserve unrelated working changes. No README edits, push, release, downloaded
unit fixtures, implicit product I/O or active SVG evaluation.

## Verification procedure

1. Reproduce isolated-instance copying of XML media with an original inert fixture.
2. Distinguish presentation XML that needs identity remapping from opaque media
   bytes; retain relationship admission and reject unresolved extension mappings.
3. Inspect ZIP payloads and relationships independently. Check deterministic
   copying, shared media retention, duplicate/delete, no-op and rename/reorder.
4. Run maintained pptx unit/lint checks, selected workspace build closure and
   focused safe-bash acceptance. Inspect an actual terminal result screenshot.
5. For disposable corpus QA, verify the manifest hash before opening a cached
   deck. Inventory SVG media and attempt only the bounded copy operation with
   explicit limits. Record rejection accurately; do not infer rendering fidelity.
6. Link exact existing case/API accounting, distinguish new format regressions
   from source case parity, and record exact JS/security behavior in research.
7. Review and stage explicitly named owned files; commit locally on main only.

## Execution receipt

The SDK and command-engine isolated-copy cases failed with `unsupported-edit`
before the fix; default shared-media behavior passed. The four-line classification
change preserves media bytes while retaining the outgoing-relationship guard.
Five domain and five actual-shell regressions now pass. Independent graph checks
confirm the existing deletion policy retains orphan media; no garbage collection
change was made. Details and exact case/API ledger boundaries are in
[the research receipt](../pptx/slide-media-lifecycle-evidence.md).

- Baseline maintained `npm test --workspace=pptx`: 257 files, 6,796 tests passed.
- Final six focused copy/removal/command files: 87 tests passed, including all
  five new domain regressions.
- Final `npm run lint --workspace=pptx`: ESLint and both TypeScript projects passed.
- `npm run build:workspaces -- --workspace=pptx`: selected dependency closure passed.
- Actual-shell lifecycle suite: all five original tests passed.

The runner registration check exposed an existing asserted sanitization test path
with no file. A separately owned original adapter regression supplies that missing
coverage without reverting the existing assertion. Its receipt/commit is separate.

Manifest hash verification and independent ZIP/XML inventory identified four SVG
media entries on slides 36/39 in the cached course deck. Both copy attempts reject
unsupported structures; no deck was published and no download occurred. Initial
resource-limit rejection under a smaller ceiling is retained in the research
receipt, not counted as a format success.

Actual `help slides duplicate` output was captured in
`.cache/pptx-corpus/slide-media-lifecycle-help.txt` and rendered through the maintained
`npm run screenshot -- cat ...` route. The inspected image is
`screenshots/cat-.cache-pptx-corpus-slide-media-lifecycle-help.txt.png`. Text is
unclipped; the existing help response includes the full command list. These
disposable artifacts are not staged. No CLI styling change was introduced.

Final `npm run lint:eslint` completed all 12,285 configured inputs with zero errors
and warnings after the separately tested bounded subject-cap increase. The exact
runner registration test passed (1,110 discovered active test files), and the two
new adapter suites passed all seven tests together.

Local delivery uses separate Conventional Commits for the cap adjustment,
properties-only adapter coverage, and slide media fix. Only relevant registration
hunks and explicitly owned files are staged; unrelated edits remain in the
worktree. Local commit hashes are reported in chat. No push or release occurs.
