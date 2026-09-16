# Notes CLI verification

Scope: new original tests in `packages/safe-bash/tests/commands/pptx/notes.test.ts`.
No adapter business logic; the existing adapter delegates to the shared PPTX engine.
No corpus downloads, native product runtime, README changes, or publication.

## Acceptance procedure

- Execute the registered command through a memfs-backed virtual filesystem.
- Confirm notes reads do not create note parts, and speaker reads exclude slide
  image/date/footer placeholders and ordinary note annotation shapes.
- Set Unicode speaker text; independently inspect package XML to assert retained
  placeholder strings, custom extension subtree and shared notes-master text.
- Edit a footer text frame and replace footer text with explicit notes shape
  selection; separately edit the notes master using its explicit text scope.
- Run a virtual `.sh` script creating and duplicating notes, editing only the copy,
  removing its association, and deleting the original slide.
- Verify dry-run and rejected cardinality/schema inputs preserve input bytes.
- Build the maintained PPTX workspace closure before verifying the public package
  imports used by the safe-bash tests. Run only the focused command tests; do not
  execute the whole pipeline.

## Evidence

The first original noncreating-read regression failed against the current public
CLI with exit 2 and `Unsupported operation` for `notes list`. The existing scoped
text-frame/footer/master editing acceptance passes (123 ms test body), using
independent ZIP assertions for changed and retained XML. Direct notes routes await
the assigned domain/engine integration; final receipts will record the focused run.

The researched notes behavior and public API obligations are tracked centrally by
the notes-domain and root owners using the pinned audit/inventory. These CLI tests
are original assets and wording. Disposable corpus inputs remain governed by
`docs/pptx/corpus-manifest.json`, and are not test dependencies.

## Final command integration and visual QA

The assigned work also adds `packages/pptx/src/command-notes.ts` and
`packages/pptx/src/notes-schema.ts`. The handler follows the existing delegated
command result/publication contract, uses the domain SDK, and adds no filesystem
or runtime authority. The scoped adapter needs no changes.

The six initial safe-bash cases passed against the built public package (1.4 s):
original package XML assertions, public SDK parity, schema result validation,
foreign field rejection, stale token rejection and virtual shell script lifecycle.
A seventh case verifies import into a destination without notes, retaining the
source master and speaker association. It also verifies that a competing master
import is rejected with no publication. Primary-standard review by the graph owner
confirmed the rejection is correct; the plan records that reasoning separately
in `docs/plans/pptx-notes-graph.md`. The final focused run passes 7/7 tests
(1.6 seconds), with no failures, skips or cancellations.

Captured and visually inspected `.cache/pptx-notes-cli.png` using
`npm run screenshot -- --no-header --output .cache/pptx-notes-cli.png node --import tsx --input-type=module -e ...`.
The inline invocation constructs an explicitly configured `Shell`,
`MemoryFileSystem`, `pptxCommands` and public `createPptxCommandEngine`, then runs
`pptx notes set --help` and `pptx notes list missing.pptx --shape Footer`.
The screenshot shows complete readable help and the bounded inapplicable-option
error, with no clipping or content leakage. `screenshot-poe-code` cannot address
this injected virtual utility because the root CLI has no PPTX subcommand. The
PNG is disposable QA output and is excluded from staging.
