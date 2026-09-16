# Cross-deck slide import

Implement the requested F08 import slice without executing the full pipeline.
Preserve unrelated work; commit only owned files locally on main, without push,
release, README edits, native product runtime or implicit host/network access.

## Ownership

The domain worker owns slide-import.ts, its original tests and the package export.
The command worker owns command-engine.ts, command-schema.ts, command import tests,
the safe-bash pptx adapter and its create/selectors acceptance. The research worker owns the supplemental
import case/API accounting and usage draft in docs/pptx. Root owns this procedure,
integration review, disposable QA, maintained checks and the atomic local commit.
The scoped safe-bash AGENTS.md requires substantive delegation; these assignments
supersede historical ownership snapshots for this task only.

## Intended behavior

Admit destination/source through explicit byte capabilities. Select an exact,
nonempty, ordered array of one-based source slide positions; reject duplicates.
Import at an explicit position or append. Preserve source appearance by default:
copy the complete supported dependency graph, including layout/master/theme cycles,
notes, media and chart workbooks; allocate deterministic names and remap IDs and
references. Never equate unrelated resources by filename or display name. No
cross-deck deduplication is claimed without independent equivalence proof.

The initial supported theme policy is source. Destination-theme adaptation remains
an explicit unsupported operation, not silently flattened formatting. Different
slide or notes dimensions reject by default; explicit destination dimension policy
retains destination sizes and source coordinates (no scaling/rendering promise).
Never change an unaffected destination member's decoded bytes.

Source slide links to unselected slides require an explicit unsupported result;
selected inter-slide links and notes backlinks must remap. Unrecognized references
that cannot be safely rewritten reject. A conflicting existing notes master cannot
be replaced or registered twice just to make the operation succeed. Preserve the
documented limitation until equivalent closure sharing or a format-valid appearance
mapping is proven.

## TDD and acceptance procedure

1. Observe missing-domain/command failures from original fast memfs cases.
2. Verify dependency closure using independent ZIP and namespace-aware XML readers,
   exact resource bytes/SHA-256, registered masters, IDs and relationship targets.
3. Exercise same-named unrelated assets, repeated imports, ordered selection,
   dimensions, unsupported theme/reference policies and prepublication isolation.
4. Verify public byte SDK and command behavior, schemas/capabilities, actual safe-bash
   invocations, stdin, dry-run and package-only stdout.
5. Reconcile relevant source test variants, BDD examples and public API rows in the
   supplemental research accounting. Adjacent object-model APIs stay visibly pending;
   copying is not evidence of setters, constructors or complete API parity. Retain
   neutral model spellings and J01–J10 language/security decisions without exporting
   arbitrary XML constructors or hiding underscore-prefixed returned interfaces.
6. Read corpus-manifest.json and hash-check a cached disposable presentation before
   exercising import. Record actual results and reduce actionable findings to small
   original tests. Never download during unit tests, ship fixture bytes or treat a
   graph-only check as visual appearance proof.
7. Capture actual help/success/error text and inspect terminal PNGs through the
   maintained screenshot runner. Keep all artifacts ignored and disposable.
8. Run maintained pptx tests/lint and selected workspace build closure, focused
   safe-bash acceptance and applicable guarded lint. Do not run the entire pipeline.
9. Review/stage explicitly named owned files with this receipt; create one atomic
   Conventional Commit locally. Report local hash separately from remote/release.

## Execution receipt

The missing import API/command first failed original tests. The domain operation
now copies the recursive supported graph, remaps local shape/relationship IDs and
global layout/master/slide IDs, and shares the existing XML copy remapper with
same-deck duplication. No resource deduplication is implemented. Distinct same-named
themes have independently asserted color/font values; destination members retain
exact independently computed hashes. Repeated imports, layout/master cycles,
notes backlinks, chart workbook bytes and selected slide links are covered.

Review reproduced sparse-array admission and caller option mutation during async
byte admission. Selection limits now precede traversal/copy, holes fail with typed
errors, and admitted options are snapshotted. Global text defaults compare expanded
names and values only after rejecting linked/extended content. Unequal defaults,
embedded font lists, tables, incompatible notes masters and unresolved references
reject rather than changing inherited appearance. Strict-to-Strict import passes;
implicit dialect conversion fails. Destination-theme adaptation remains unsupported.

The adapter's original hardlink test reproduced forced publication over a secondary
source. Publication now checks every protected source identity, including resolved
symlinks and normalized source/destination aliases. Exact CLI statuses, empty failed
result effects, source preservation, stdin cardinality, dry-run, binary stdout and
SDK/shell byte parity pass. The initial symlink regression needed explicit memfs
readlink/realpath methods; that harness failure is not claimed as a separate product
defect. No implicit filesystem or native runtime behavior was added.

Maintained checks passed: `npm test --workspace=pptx` (851 tests, 29 files),
`npm run lint --workspace=pptx` (ESLint and source/test TypeScript), and
`npm run build:workspaces -- --workspace=pptx` (three declared build dependencies).
The exact focused adapter command passed 60 tests:
`node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/pptx/create.test.ts packages/safe-bash/tests/commands/pptx/selectors.test.ts`.
An attempted workspace runner with literal file operands was stopped because it
discovers all tests rather than filtering; it is not recorded as a completed gate.
No full repository test or complete pipeline run is claimed.

The research supplement individually retains 383 unit variants, 41 BDD examples
and 455 public API records with exact canonical pointers and language mappings.
All remain honest adjacent model obligations; import does not complete those APIs.
No copied reference implementation, test bodies or assets were added. Existing
standalone notices cover retained provenance; source identities appear only there
and in research/plans. The latest user requirement resolves themePolicy default
drift in favor of source appearance.

## Disposable and visual QA receipt

Hash-verified two cached manifest fixtures before admission:

- CERN-job-opp-250925.pptx:
  `85cc7b338a11b9d1a9dfcaaaa504bf21ab643e4c30004a478152f390ee9f5f1d`.
- WWL-template-1slide.pptx:
  `0c728ea3fd2ab76906247931fcb5c966074d21e804187893d954cc913cc89689`.

Final-code imports of slide 1 into an original authored destination, with explicit
destination dimensions, both rejected `unsupported-edit` because presentation-wide
text defaults differed. Destination bytes remained unchanged. An earlier run before
that safeguard reached and rejected extension references; independent ZIP/XML
inspection found creation-identity extension lists. Original defaults/opaque
extension regressions cover these boundaries. No download, shipped corpus output,
successful real-world import or slide-rendering fidelity is claimed.

Actual final engine help, authored success and invalid-selection output were
captured and rendered using `npm run screenshot`, the maintained generic route for
the safe-bash command (not a root poe-code subcommand). PNGs were inspected for
legibility and clipping. Ignored artifacts are exactly
`.cache/pptx-corpus/qa-slide-import-{help,result,error}.txt` and
`.cache/pptx-corpus/qa-slide-import-{help,result}.png`.

## Local delivery

Root guarded `npm run lint:eslint` passed all 11,874 configured inputs with zero
errors and warnings (complete traversal and 25 validated receipts). Final review
found no whitespace errors or reference identities in new product files. Only the
explicitly owned implementation, acceptance, research/usage and this plan are
staged for the atomic feature commit. Unrelated modifications and ignored QA
fixtures remain untouched. The local commit hash is reported separately in chat
and Git history. No push, remote-main verification or release was attempted.
