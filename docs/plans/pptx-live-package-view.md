# Live presentation element and package views

Owner: root integration; XML view/parser implementation delegated to xml_views;
independent inventory and owner review delegated to surface_audit. Preserve all
other working-tree changes. No README, network, native runtime, push or release.

Use the existing Presentation/loadShared state and original XML/OPC validators.
Expose owner-bound presentation element/part and returned package lookup, part
metadata, relationship snapshots and isolated bytes. Every successful write must
participate in revision tracking; reject invalid candidates before staged state
changes. Keep actual JavaScript capabilities private, not merely TS-private.

TDD: package-view.test.ts first failed for missing part, missing element and leaked
state fields. Blob mutation also reproduced missing authored size validation.
The shared read validator intentionally permits repairable partial size metadata;
validation of new XML writes belongs in the shared XML replacement operation.

Agent QA:
1. Run original view/model/operation tests and verify save/reopen and stale guards.
2. Check opaque/MCE/dialect/relationship preservation, bounded structured edits,
   explicit cancellation, byte ownership and unchanged memfs publication targets.
3. Run maintained pptx lint, tests and selected workspace build closure.
4. Inspect export declarations and commit only owned changes after checks.
5. Record exact passing subset and remaining graph/API work in docs/pptx.

Completed checks and review:
- Initial missing part/element, runtime-private authority, invalid authored sizes,
  duplicate opaque-node removal/movement and restored-byte stale-handle cases
  failed before their fixes. Both duplicate occurrences are now counted, and
  XML cache identity tracks staged revisions rather than byte equality.
- Maintained `npm run test --workspace=pptx`: 5,977 passed in 210 files.
  After the final cache refinement, 40 model/view/CLI cases passed, including
  the newly added restored-byte invalidation regression.
- Maintained `npm run lint --workspace=pptx` and selected
  `npm run build:workspaces -- --workspace=pptx` passed at that checkpoint.
  Final cache-refinement lint and selected workspace build also passed.
- Actual rebuilt XML help excerpt was captured through the maintained screenshot
  runner at `/tmp/pptx-live-xml-help.png`; visual inspection confirms legibility,
  the bounded editing statement and exit 0. No screenshot fixture is committed.
- Independent review covered authority leakage, relationship spelling, duplicate
  opaque-node occurrences and model/CLI publication parity. Its original memfs
  integration suite passes all ten tests.
- The independent XML view/parser component is local commit `dac6d291c`.
  This plan accompanies the separate owner/CLI integration commit.

Remaining scope is explicit: this completes this bounded presentation XML/part
view integration, not the full live slide/layout/master/drawing/chart object
surface. Binary/other-XML part blob writes and arbitrary XML structures remain
visible unsupported public behavior, not private-helper exclusions. No push or
release is authorized or performed; all unrelated changes remain outside commits.
