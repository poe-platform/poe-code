# Section and custom-show membership

Implement F09 using the shared command/SDK contracts. Original byte-domain logic
stays in packages/pptx; existing safe-bash adapter delegates to that engine.
No whole pipeline, README edits, host I/O, network, push or release.

## Ownership

Root owns slide-copy.ts/test, public index exports, this plan, integration QA and
local Git delivery. Delegated memberships owns memberships.ts/test. Delegated
cli_membership owns command-engine/schema and command-membership.test.ts plus
assigned existing registered safe-bash acceptance. Delegated membership_audit owns
section-show-case-accounting.json and draft section-show-usage.md. Other changes
are excluded from commits. Deletion policy correction has its own atomic plan.

## Decisions

Section and show IDs remain stable under rename/reorder/membership replacement.
New IDs are deterministic, collision checked, and independent of names. Empty
display names are intentional per spec 6.3; empty lookup names are rejected.
Duplicate names require identity selection. Sections have contiguous, nonoverlapping
slide positions; show replacement accepts ordered unique positions. Existing
repeated show entries remain on unrelated edits and every deleted occurrence is
pruned. Hidden slides remain eligible without changing visibility.

Duplication inserts newly allocated IDs into the section only when insertion is
strictly inside its member span. Before/after boundaries do not infer membership.
Existing show references keep their original identities and order. Section
extension structures that cannot be safely interpreted are rejected. Opaque
unaffected bytes are retained through bounded XML patching.

Research receipts remain under docs/pptx. The supplemental case ledger accounts
for adjacent source variants/BDD scenarios and APIs without claiming a completed
live model. Product implementation and fixtures are original. Required existing
standalone legal notices are retained; no source identities enter product files.

## TDD and QA procedure

1. Add original memfs SDK/CLI cases and observe failure before implementation.
   Independent ZIP and namespace-aware XML assertions verify serialized IDs,
   membership order, extensions, visibility and unchanged parts.
2. Run maintained pptx test/lint and selected workspace build closure, then the
   existing registered safe-bash acceptance files. Do not execute the pipeline.
3. Verify manifest SHA-256 before reading cached fixture bytes. Use explicit
   contexts and disposable outputs prefixed .cache/pptx-corpus/qa-memberships-.
   Independently inspect ZIP/XML for CRUD and unchanged unrelated member bytes.
4. Capture actual help and mutation output with the maintained screenshot runner;
   inspect PNGs. All fixtures/captures remain ignored. Structural inspection does
   not certify application rendering. Reduce meaningful findings into original tests.
5. Review owned diffs and stage explicit files for atomic Conventional Commits on
   main. Report local hashes separately; do not push or release.

## Verification receipt

Initial CRUD tests failed with missing SDK exports/unsupported CLI operations.
A separate duplicate-inside-section assertion reproduced the omitted copied ID.
Independent review also reproduced invalid stored show IDs, numeric identity
aliases, masked unsupported section extensions, reversed all-show moves, invalid
intent hidden by allowEmpty and deletion of actively referenced shows. Each is
covered by original regressions. Names and relationships use bounded XML patches;
source identities do not enter code, comments or test assets.

The final maintained package suite passes 944 tests in 33 files. New domain cases
number 26 and command cases 16, taking about 0.6 seconds per suite in the final
run. Both source and test TypeScript projects and package ESLint pass.
The maintained selected build closure passes for office-package, toolcraft-schema
and pptx. The registered safe-bash create/inventory/selectors files pass 67 tests
via `node --import tsx --test`; owned adapter ESLint passes. An attempted scoped
safe-bash npm test was stopped when its runner selected full discovery despite
the supplied file; it is not recorded as a pass or whole-pipeline execution.
`git diff --check` passes.

The spec now explicitly records show add/set position, original repeated-show
preservation, section insertion policy and referenced-show deletion refusal.
The write-spec checker passes with no warnings. Its Proposed / Implemented Through:
Not applicable metadata remains: this feature does not certify full format/API
conformance. The inspected parent was e450282f2b13aaa1584f8d497896909346084ce8.
Research accounts for 94 adjacent unit variants, 82 expanded BDD cases and 101
related API records; none supplies a direct section/custom-show container editor.
Pending live-model obligations remain visible and are not promoted to passes.

## Disposable QA receipt

Manifest SHA-256 admission passed for IXPE-Presentation-Template.pptx
(885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c)
and WWL-template-1slide.pptx
(0c728ea3fd2ab76906247931fcb5c966074d21e804187893d954cc913cc89689).
Public built SDK add/rename/reorder/replace/remove succeeded on both. Independent
Python ZIP/XML assertions verified exact stable IDs, final membership/order and
unchanged member names/bytes outside presentation.xml. Removing all added
containers restored every original member byte-for-byte. The five-slide source
has nonmonotonic IDs; an initial QA expected-ID assumption was corrected against
the original package, confirming the product correctly follows slide-list order.
No application rendering/playback fidelity claim is made.

Reviewed actual engine help and human dry-run output as screenshots. The first
result exposed singular grammar and missing cleanup/schema help; an original
failing command test now guards the corrected text. Final help membership lines
and result are readable. Existing long general-help lines remain as before.
Owned ignored artifacts use only .cache/pptx-corpus/qa-memberships-: ixpe/wwl
edited and -removed decks, help/result text, and original/final help/result PNGs.
No downloads, native product runtime, fixture commits or README edits occurred.

## Local delivery

The deletion policy fix has a separate atomic commit and plan. The feature commit
contains domain/command/adapter coverage, duplication consistency, spec correction,
research accounting and draft usage. Root stages explicitly named files only;
unrelated work remains untouched. Local hashes are reported in chat and Git
history. No remote-main delivery or release was attempted.
