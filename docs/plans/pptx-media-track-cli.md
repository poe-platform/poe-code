# Media track CLI preservation

Ownership: the original `packages/safe-bash/tests/commands/pptx/media-track-preservation.test.ts`
and its one literal registration in `scripts/integration-inputs.test.mjs`;
this plan. Root owns the domain fix, shared checks and commits. No source,
README, corpus, release or pipeline changes belong to this worker.

## Cases and evidence

The small authored package contains two independent WebVTT tracks, English and
French labels, opaque language attributes, millisecond range attributes, cue
times, trim, loop, volume and an unknown Japanese label. Replacement through
the real virtual shell must preserve the exact track/unknown XML fragments,
both track payloads and relationship targets. An independent ZIP assertion
reader checks output members; SDK inventory checks the surviving two video
bindings and does not claim playback. All input reads use memfs-backed injected
filesystem methods; the original package remains byte-identical.

Three separately named original cases alias an unknown metadata relationship
to the legacy clip, embedded media and poster binding. Each must reject with
`unsupported-edit`, operational-error status 1 and zero binary stdout. Before
the domain rebuild, all three emitted a successful package; after the root
fix they reject. These are original regressions, not copied reference fixtures.

Consulted `docs/specs/pptx.md`, shared office CLI/SDK contracts, root/scoped
AGENTS, upstream test audit/inventory and public API audit/inventory. Exact
upstream accounting and extension-schema evidence stay with the research owner;
these shell tests do not establish complete public object-model coverage.

After independent schema review, both new fixture files use the validated
media extension URI `{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}` and track extension
URI `{3AFAAA56-56D3-431D-BCD4-E75A35582382}`. The original opaque metadata remains
unknown and unchanged; this correction does not assign semantics to its
language or range attributes.

## Separate observed limitation

An initial complete original graph with `/deck.xml`, `/slide.xml`, `/layout.xml`
and `/master.xml` at the package root passed presentation graph admission but
`media replace` failed `unsafe-path: Invalid package part name`. The same graph
under `/ppt/` succeeds. To reproduce from this test fixture: remove the `ppt/`
prefix from generated ZIP member names except `[Content_Types].xml` and
`_rels/.rels`, remove `/ppt/` from the four content-type override part names,
and change the root officeDocument target from `ppt/deck.xml` to `deck.xml`.
Keep slide relationship targets relative as authored. Invoke the existing
replacement command. At the QA checkpoint the media writer passed an empty
slide-owner directory to `relativePartReference`. Moving the fixture under ppt
did not fix or establish support for this separate observed limitation.

The subsequently authorized fix and separate red-green regression receipt are
recorded in [the root-owner plan](pptx-media-root-owner.md).

## Validation and visual QA

1. Run the selected maintained build closure:
   `npm run build:workspaces -- --workspace=pptx` (passed, three build tasks).
2. Run the two exact CLI test files with the package's node:test/tsx harness:
   `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/media-track-preservation.test.ts packages/safe-bash/tests/commands/pptx/media-inventory.test.ts`.
   Eight cases passed in approximately 1.2 seconds after rebuild.
3. Run `node --test packages/safe-bash/scripts/integration-inputs.test.mjs`
   to authenticate exact registration without executing the full shell pipeline
   (107 cases passed, approximately 14.6 seconds).
4. Capture actual `help media replace` output using `npm run screenshot` with
   an explicitly bounded `createPptxCommandEngine` and a read callback that
   throws on unexpected input access. Inspect `.cache/pptx-media-track-help.png`.
   The inspected capture has readable complete media selector, replacement,
   poster, output and preservation guidance. The utility is injected into the
   virtual shell rather than exposed as a root poe-code subcommand.

The screenshot is disposable and must not be staged. Downloaded fixtures remain
outside these tests; any broader QA uses `docs/pptx/corpus-manifest.json` and
must reduce findings into original fixtures. No playback or full fidelity claim.

Maintained `npm run typecheck --workspace=virtual-bash` passed: source and tests,
26 current consumer groups, expected negative type cases, zero builds and clean
temporary cleanup. Root's guarded `npm run lint:eslint` exited 2 at the fixed
12,000-subject cap (12,001 configured, 12,000 linted). Zero raw findings does not
make this a passing gate. Limits were not changed and no bypass was used.
The required maintained-check prerequisite therefore blocks commits; no local
commit, push or release was made.

Final verification after the registered media/track URI corrections: the selected
pptx build closure passed, followed by all 10 cases across the two new files and
existing media-inventory file (approximately 2.3 seconds). No lint-cap retry or
guard modification was attempted.
