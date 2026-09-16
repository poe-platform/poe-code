# PPTX links accounting and QA

Scope: F47 ordinary links, supported slide navigation, inert unsupported action
inspection, owner-scoped relationship edits and graph-preserving merge. This
worker owns links research receipts, draft usage and the independent
`packages/pptx/src/links-actions.test.ts` regression suite. Domain and CLI workers
own their implementation and other tests. No README, native runtime, downloads,
push, release or whole pipeline execution.

## Research and original acceptance

1. Read the pinned test/API audits and inventories, shared CLI/SDK contracts and
   F47. Keep every selected unit variant and expanded BDD example individually
   addressable in `docs/pptx/links-case-map.json`.
2. Compare pinned parameter values and source semantics. Author original assets
   and wording. Keep reference identities only in research and retain the
   existing standalone MIT notices.
3. Record inherited, returned, underscore-prefixed and untested action public
   members in `docs/pptx/links-api-map.json`. Distinguish bounded operations from
   the outstanding live model; no whole-API parity claim.
4. Run the original inspection cases red, then green against the domain worker.
   Initial red: 2026-09-13, `npx vitest run
packages/pptx/src/links-actions.test.ts` failed because `./links.js` did not
   exist. Fixtures use memfs and original inline XML, no host fixture reads.

## Disposable QA procedure

1. Select only existing cached files named in `docs/pptx/corpus-manifest.json`.
   Verify each SHA-256 against its manifest record before product inspection.
2. For small presentations with click links, run `listLinks` on explicitly
   supplied bytes and compare action/link counts with an independent XML parser.
   A manifest whole-package count includes masters/layouts; account for scope.
3. Compare bytes before/after reads. Do not follow any URL or invoke an action.
   Do not publish or commit input/output binaries. Leave existing fixtures owned
   by other campaigns intact.
4. Reduce a meaningful discrepancy to original tiny XML/memfs regression cases
   before changing product code; repeat the focused failing check and relevant
   maintained workspace checks.
5. Record exact results and remaining gaps in `docs/pptx/links-evidence.md`.

## Verification status

Initial red test recorded above. Focused green, maintained checks and disposable
QA are pending implementation. Root owner records final commit/check receipts.

## Completed model follow-up

Root delegated the synchronous action model after initial accounting. Added
`links-model.ts` and original `links-model.test.ts`; initial red was missing
module, then an independent empty-link classification regression failed before
its fix. The domain worker factored `openLinkSession` so property setters share
real synchronous package edits, with async admission/save. LinkShape/LinkRun bind
shape/run members to it. Original package regression failures established group
access timing, invalid run path and foreign namespace identity shadowing before
fixes. Duplicate drawing IDs reject rather than picking the final match.

Focused model and package link suites pass; root owns final maintained checks.
Corpus QA delegated back to root while this worker completed the real model.

Root's independent schema review identified the distinct run hover spelling.
Changed the original table fixture to `a:hlinkMouseOver`, observed a real failing
empty inventory, and added independent SAX element-name verification of live
hover edits. Domain worker owns the matching read/write fix. Reverted only this
worker's receipt insertion into the preexisting untracked test audit; its baseline
contents remain untouched and are not included in this task's staged files.

A final source behavior check identified named-slide `Hyperlink.address` as the
literal relationship target. Original session assertion expected `slide3.xml`
and failed with null. Domain added inert `targetReference`; the model now uses
that fallback without changing operation URL classification.
