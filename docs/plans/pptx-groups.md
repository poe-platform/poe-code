# PPTX group geometry

Scope: implement explicit `shapes.group` and `shapes.ungroup` through the SDK and
safe-bash `pptx` command, preserving slide-space geometry within caller-supplied
EMU tolerance, existing shape IDs, references and sibling paint order. No full
pipeline, push, release, README changes or downloaded unit assets.

Authority: `docs/specs/pptx.md`, `docs/specs/office-cli.md`,
`docs/specs/office-sdk.md`, root and safe-bash `AGENTS.md`.

Ownership:

- Engine agent: new group geometry implementation and original in-memory tests
  in `packages/pptx`; geometry validation precedes all mutation.
- CLI agent: command schema, package operation wiring and safe-bash adapters/tests.
- Audit agent: this plan and new `docs/pptx/groups-*` receipts/usage; existing
  untracked research files and README remain untouched.
- Coordinator: integration, independent review, maintained checks and explicitly
  staged atomic Conventional Commit on main. Report local hash; do not push.

Verification procedure:

1. Reproduce the unsupported operation with original fast tests before code.
2. Assert literal union bounds, serialized offsets/child extents and original
   IDs. Exercise nested unequal scales, quarter/general rotations, both flips,
   and measured post-serialization geometry with explicit zero/positive tolerance.
3. Reject singular child extents, unsafe/nonfinite tolerance, precision beyond
   tolerance, unrepresentable shear/unsupported shapes, non-siblings and
   noncontiguous grouping if the original paint order cannot be retained.
4. Exercise connectors and timing references: retain unchanged child IDs, and
   reject unsupported references to removed group IDs without publishing output.
5. Run paired SDK and CLI tests using memfs. Confirm common selector cardinality,
   structured errors, dry-run behavior and executable schema/capabilities.
6. Run the maintained package test/lint/build closure appropriate to the touched
   workspace; run CLI screenshot validation for visible command changes.
7. For disposable corpus QA, consult `docs/pptx/corpus-manifest.json`, use only
   listed cached files and verify their hashes before admission. Choose a slide
   with supported adjacent shapes, compare before/after geometry and references,
   and retain only a concise receipt. Do not download inside unit tests, commit
   binaries or delete someone else's cache. Convert any meaningful finding into
   a small original regression before closing it.
8. Reconcile exact case IDs in `docs/pptx/groups-case-map.json`, inherited public
   API obligations in `groups-api-map.json`, and implementation limitations in
   `groups-usage.md`. Existing transform mappings remain authoritative for
   unchanged inherited geometry cases.

The case ledger includes neighboring live group model/collection obligations as
visible gaps. A bounded safe group operation does not complete automatic empty
and single-child group creation, returned collection APIs or whole-public-API
coverage. Those gaps must not obscure whether the requested group/ungroup
operation itself has been implemented and checked.

## Execution receipt

Coordinator corpus QA admitted the manifest-listed cached
`SEWP_Provider_Training_Slides_05_12_25.pptx` (6,824,998 bytes, SHA-256
`3695972c410e1a8862f72962d706bdfde1e680a144b48bf2bb9bb8095ecca3b5`).
The public byte SDK and package CLI with memfs both attempted slide 2, group 9,
ungroup tolerance 1 EMU. Both rejected unsupported group metadata with
`unsupported-edit`; CLI returned exit 1, `ok: false`, affected 0, publication
calls 0. With explicit force and a preexisting destination, its literal content
remained unchanged. Input hash remained unchanged. No fixture/output bytes were
committed or modified. This is rejection/publication QA, not a successful corpus
rendering or broad fidelity claim.

Independent review reproduced two defects in the initial implementation: a foreign
namespace child with a familiar shape name could be omitted, and a fractional
displacement at a large coordinate could disappear before tolerance comparison.
Original regressions now reject the metadata loss and use exact rational arithmetic
to expose the displacement. Nonidentity flattening supports quarter-turn chains of
plain rectangles without text/styles/strokes and nested groups. General-angle
flattening rejects; identity wrappers preserve arbitrary-angle child XML structurally.
Populated timing/extension trees reject during ungroup, because their opaque
references cannot be safely retargeted. Child IDs and supported connector targets
remain unchanged. Unknown group actions/metadata also reject.

Both operations reject `all`/`allowEmpty`: explicit group locations and exactly one
ungroup target define their supported cardinality. The generated schema, runtime
validation and exported option types agree. The broader proposed format command
table does not establish support for these controls.

## Final verification

- TDD first run: all 2,385 existing tests passed; new missing engine/command tests
  failed. The precision, foreign metadata and empty result-reference findings were
  separately reproduced before fixes.
- `npm run test:unit --workspace=pptx`: 83 files, 2,417 tests passed. This includes
  27 original group engine cases and five memfs command cases. The final subsequent
  type-only narrowing also passed the focused 32 tests and package lint.
- `npm run lint --workspace=pptx`: ESLint plus source and test typechecks passed.
- `npm run build:workspaces -- --workspace=pptx`: selected maintained dependency
  closure passed, three declared builds; final emitted declarations were reviewed.
- `node --import tsx --test --test-concurrency=1
packages/safe-bash/tests/commands/pptx/create.test.ts
packages/safe-bash/tests/commands/pptx/selectors.test.ts`: 88 passed, zero failed
  or skipped. The actual registered Shell executes a quoted `.sh` grouping workflow,
  matches byte SDK publication and retains independently asserted IDs/corners.
- The existing adapter is generic and needed no product changes. Its modified
  test file is already explicitly registered in `scripts/integration-inputs.test.mjs`.
- Terminal QA used the maintained `npm run screenshot` route with an inline
  TypeScript-enabled Node invocation hosting Shell/MemoryFileSystem and the source
  command engine. Capture `pptx shapes group --help`, then ungroup dry-runs missing
  tolerance and missing selection. `/tmp/pptx-groups-help.png` was visually inspected:
  readable, complete support limits, help status 0 and both usage errors status 2.
  The generic screenshot route is appropriate because `pptx` is an explicit Shell
  command, not a root poe-code subcommand. No screenshot unit test was added.
- Research receipts retain 58 distinct exact source-case identities and 41 exact
  public group API inventory rows. Three geometric domain mappings have original
  evidence; 55 neighboring model obligations remain explicit gaps. Whole model API
  parity is not claimed. Existing standalone MIT notices remain intact; all newly
  authored code, test wording and XML are original.
- No README, fixture bytes, root wiring, pipeline execution, push or release.
  This is one atomic local feature commit on main, including its owned plan and
  research/usage receipts. The local commit hash is reported separately in chat.

Final capability reconciliation narrows these fixed-cardinality operations:
`--all` and `--allow-empty` reject and are omitted from the executable operation
schemas. Nonidentity ungroup supports exact rational certification only through
quarter-turn transform chains; unsupported general-angle flattening rejects.
Identity wrappers retain general-angle child XML structurally. Original union
cases retain literal expected bounds `(1,2,39,58)`, `(50,50,125,75)` and
`(300,400,300,500)`. Nested corners are asserted independently as
`(90,110)`, `(110,110)`, `(110,120)`, `(90,120)`.
