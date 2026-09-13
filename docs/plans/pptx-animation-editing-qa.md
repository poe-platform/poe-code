# Animation editing implementation and QA

Scope: F46's appear, fade-in, fade-out and pulse effects; on-click,
with-previous and after-previous triggers. No whole pipeline, push or release.

## Ownership

- Root coordinates review, corpus QA, maintained checks and local commits.
- timing_domain owns animation-editing domain implementation, original SDK
  regressions and necessary object/reference integration.
- timing_cli owns animation command/schema/export hunks, original command and
  safe-bash tests, and their exact discovery registration.
- timing_research owns new focused case accounting, mappings and usage drafts.

Existing image/media changes and unrelated files remain outside these commits.
No README or downloaded fixture is edited or staged.

## Procedure

1. Establish failing original tests before implementation. Independently inspect
   output XML targets, timing IDs, effect values and dependency edges.
2. Exercise add/set/remove, target selection, object duplication/deletion/import,
   unsupported timelines and failed publication through SDK and CLI.
3. Run maintained pptx test/lint and selected workspace build closure. Run focused
   safe-bash adapter/discovery checks; do not execute the whole pipeline.
4. Verify SHA-256 for manifest-listed cached decks. Try supported authoring on
   a slide without timing and unsafe editing of a complex timeline. Check input
   bytes and unsupported XML preservation independently. Use disposable outputs.
5. Inspect command help/output through the maintained terminal screenshot runner.
   Record playback as unverified; this task checks serialized semantics.
6. Reconcile all relevant parameter variants/scenarios and public API obligations.
   Stage named owned files and only owned shared-file hunks; commit on main.

## Initial corpus admission

SHA-256 matched the manifest for IXPE-Presentation-Template.pptx,
CERN-intro-2025-v2.pptx and ISOLDE-drawings.pptx. Independent ZIP/XML inspection
found timing on four intro slides (232, 68, 122 and 49 elements), five drawings
slides (four elements each), and no template slide. These are QA inputs only;
tests use original in-memory XML and never require downloads.

## Executed corpus and lifecycle checks

- The admitted template's slide 1 accepted a 501 ms pulse targeting an existing
  shape. The output had six unique timing IDs and no inventory diagnostics.
- Editing the intro deck's complex slide 15 and drawings deck's incomplete
  slide 4 timing each failed with `unsupported-edit`. Both memory input bytes
  and cached-file hashes remained unchanged; no publication occurred.
- Adding a fade to intro slide 1 preserved every pre-existing timing XML slice
  across all 32 slides. No corpus output was written to disk.
- Three original media creation variants independently assert IDs, targets,
  indefinite start conditions, byte-preserved existing video markup, and an
  opaque extension retained when a child list is absent. Existing media code
  needed no change. Initial fixture checks exposed and corrected test-helper
  document ownership and archive-version assumptions; these were not product
  failures.
- Three original lifecycle tests verify drawing duplication keeps animation
  targets on the originals, deletion fails until effect removal/retargeting,
  and imported effect dependencies remain valid and editable.
- Review found flat sequence children could not express with-previous
  activation correctly. A failing structural regression led to shared parallel
  click groups with explicit begin/end references. Additional regressions guard
  external references, malformed option data and unsupported effect durations.

The empty timing root found in corpus QA is retained as a small original
regression in the domain suite. No rendering or playback was used as a semantic
oracle. Corpus inputs and unrelated workspace work remain untouched.

## Final verification and delivery

- `npm run test --workspace=pptx`: 150 files, 3,938 tests passed in 43.67 s.
- `npm run lint --workspace=pptx`: ESLint and both production/test TypeScript
  checks passed.
- `npm run build:workspaces -- --workspace=pptx`: maintained declared
  three-workspace build closure passed.
- Final test-only target-admission additions bring the domain suite to 19 cases.
  An isolated copy of exactly the staged package passes production/test `tsc`
  and all 35 tests in the four new domain/command/lifecycle/media suites. This
  independently excludes unrelated unstaged image/media implementation changes.
- The expanded safe-bash script passes, including atomic batch through the VFS.
  Its exact normal-runner discovery assertion and supplemental scoped strict
  TypeScript check pass. This is not a whole safe-bash test/typecheck claim.
- The maintained screenshot runner captured actual animation and batch help at
  `/tmp/pptx-animation-editing-help.png`; visual inspection found complete,
  legible output and status 0. The virtual utility is exercised directly because
  the top-level poe-code CLI does not own this injected command engine.
- Commit isolation found incorrect offsets in a filtered zero-context patch.
  The index was reconstructed from original hunk coordinates, then compiled and
  tested independently. No working source was changed. Exact added/removed lines
  of all unrelated shared-file edits still match the initial snapshot.

The first local atomic commit is `6ba90179a` for independent media timing
assertions. The remaining feature changes are committed separately after these
checks. No push, remote-main delivery or release was attempted.
