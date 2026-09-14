# DOCX simple-selector ergonomics

Task: `simple-selector-ergonomics` only. Work on main; local commits only.
Later feature editors and help/output tasks remain pending.

## Ownership

Owned: new selector module/tests in packages/docx/src, required changes to
locations.ts, location-index.ts, index.ts and command.ts, this plan and
 docs/docx/simple-selector-ergonomics.md. Preserve the existing pipeline edits
and archive move without staging them. No safe-bash changes are needed; its
injected command engine remains the transport boundary.

## Execution and QA

Read the root/scoped instructions, three normative contracts, both upstream
audits and JSON inventories. Retain all documented model coverage obligations.
Implement the shared admitted-document selector resolver, keeping feature edit
bodies in their later ordered tasks. Add original memfs SDK/CLI paired cases
and observe failure before implementation. Exercise scoped one-based positions,
logical merged cells, stale tokens, cardinality, shared resources and existing
publication semantics. No external documents or native runtime are required.
Run the maintained docx tests, lint and selected workspace build closure.
Inspect changed error presentation with a disposable terminal screenshot.
Record results and limitations in docs/docx. Commit explicit owned paths with
Conventional Commits, without pushing, bypassing hooks or staging unrelated work.

## Results

The selector layer is implemented and verified; complete end-to-end edit
acceptance remains pending with later feature editors. The injected CLI handler
boundary is unchanged. This does not mark the whole pipeline task complete.

Failing tests preceded code. The initial fixture omitted the mandatory archive
comment; after correcting the original fixture, all seven initial tests failed
on the missing resolver. Further failing cases exposed lost local ordinals,
empty-list cardinality, all-stories header scope, insertion containers/tokens,
wrong-story tokens, scalar table tokens, accessor invocation, nested section
breaks and premature shared-story checks before text matching. Each was fixed
and the retained package suite was rerun. Final count: 711 passing tests,
including 24 new original cases, with no skips.

Final lint and the selected three-package build closure passed. The actual
command-engine usage errors were rendered with terminal-png and inspected at
`/tmp/docx-simple-selector-errors.png`; no screenshot unit tests or QA runner
scripts were added. Evidence and exact mappings are recorded in
`docs/docx/simple-selector-ergonomics.md`.

Final owned paths: packages/docx/src/{simple-selection.ts,
simple-selection.test.ts,location-index.ts,locations.ts,index.ts}, this plan,
and docs/docx/simple-selector-ergonomics.md. No command.ts change was needed.
The main pipeline's preexisting edits and unrelated archive move remain untouched
and unstaged. No subsequent task, README, corpus cleanup, push or release occurs.

## Verification correction, 2026-09-14

Reviewed implementation commit `8ac6a4d32` against the task and shared contracts.
Own only simple-selection.ts, simple-selection.test.ts, this plan and the
existing selector evidence receipt. Leave the main pipeline and archive move
alone. No safe-bash implementation changes or delegation are needed.

The baseline maintained package test passed all 711 cases; lint and selected
build closure passed. DOCX section 6.5 explicitly permits section-local
header/footer unlinking. Two new original memfs cases failed before the fix:
`resolveDocxSelection` threw `ambiguous-selection` for section 2 with
`linkToPrevious: false`. Permit that explicit section-local intent at selection;
keep shared tokens without a selected section ambiguous. Paired SDK/CLI cases
cover unlink alone and unlink with text, retained section positions and unchanged
source snapshots. They do not implement the later clone/rebind editor.

Final package test: 713 passing, 24 files, no skips. Lint and maintained selected
build closure passed again after the code correction. Inspect the retained
error screenshot and actual test output, check the owned diff, then commit only
the four owned paths. Detailed results and acceptance gaps are in
docs/docx/simple-selector-ergonomics.md. Do not mark complete end-to-end routine
editing or whole-model acceptance as passed.
