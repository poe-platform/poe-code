# OBJ-002: sparse clone and checkpoint preservation

## Authority and baseline

- Directly delegated functional fix author; independent validation remains separate.
- Isolated main clone: `/Users/kjopek/Workspace/poe-code-safejs-sparse-checkpoint`.
- Origin inherited from `poe-code-safejs-publish`; cloned main and immediately pulled
  with `git pull --ff-only origin main` before investigation.
- Base: `33c73a21fb01875b0e2297ccac955974a0889991`.
- Before archive payload reads, bootstrap the 38 exclusions from
  `inventory-verification.json` and exclude the entire `security/` tree. Read only
  individually allowlisted artifacts recorded in the ignored evidence bootstrap.
- Never modify original artifacts or other clones. No branches, commits, pushes,
  guest IO, real LLM calls, or security investigation.

## Diagnosis and scope

The graph-depth walker maps sparse arrays into sparse entry lists, then
destructures missing entries. Fixing only traversal leaves two lossy checkpoint
representations: JSON converts mapped holes to null; the public dump materializes
holes as explicit undefined. Both serializers also omit named enumerable array
data, including `metadata` and `raw`.

The metadata observation is tracked separately from OBJ-002. Its indexed aliases
survive while its named aliases disappear. Include a remedy only for that same
array-representation root, with separate regressions for both serializers,
alias discovery, cycles, and explicit undefined. Do not claim all array-own
semantics, descriptor flags, non-enumerable properties, symbols, or accessors are
fixed.

## TDD and implementation sequence

1. Freeze source preimages and hashes before edits. Install with
   `SKIP_SYNC_SKILLS=1 npm ci` and build the required dependency closure.
2. Run untouched full original codec workflow and original sparse clone reduction
   against native and base SafeJS. Retain outputs, errors, budgets, and commands.
3. Add pure in-memory regressions first and retain RED output.
4. Walk actual array entries and preserve length plus present enumerable keys in
   JSON-portable array heap records. Keep dense/legacy checkpoint compatibility.
5. Validate the representation in both readers, including existing configured
   collection limits, without broadening into unrelated issues.
6. Run focused GREEN, adjacent snapshot/interpreter tests, full configured tests
   with `env -u TERM`, package/root configured types, lint, and format checks.
7. Repeat the unchanged original workflow, serialize intermediate checkpoints,
   and resume each retained boundary with pure deterministic host stubs. Compare
   full outputs with native, not just reductions or rewritten dense variants.
8. Freeze patch, changed files, preimages, original hashes, and validation records
   beneath ignored `out/safejs-remediation/obj-002/manifest.json`.

## QA boundary

Execute these steps as agent-driven markdown QA, not a checked-in QA program.
New unit tests use no filesystem or network. No visual CLI surface changes are
planned, so screenshot validation is not applicable. Preserve failed command
logs and exact diagnoses; independent-validator signoff is not an author claim.

## Author results

### Exact deliverable files

- `packages/safejs/src/graph-depth.ts`: walk actual enumerable data entries rather
  than destructuring holes produced by array mapping.
- `packages/safejs/src/snapshot/arrays.ts`: shared array heap representation;
  sparse/named arrays carry explicit length and present entries.
- `packages/safejs/src/snapshot/serialize.ts`: select the lossless representation
  and discover references through named array entries.
- `packages/safejs/src/snapshot/dump-format.ts`: apply the same representation and
  reference discovery to public checkpoint dumps.
- `packages/safejs/src/snapshot/restore.ts`: allocate length before restoring
  present keys, preserving cycles and aliases; continue reading legacy items.
- `packages/safejs/src/snapshot/validation.ts`: validate the new representation
  and its logical length against existing collection limits.
- `packages/safejs/src/snapshot/array-shape.test.ts`: 19 in-memory regressions and
  controls across cloning, both serializers, and automatic checkpoint/resume.
- `docs/plans/safejs-fix-obj-002.md`: this plan and author handoff.

### RED / GREEN

- Initial RED: 15 failures / 4 passes. One dense native comparison incorrectly
  required ordinary object prototypes; SafeJS intentionally uses null-prototype
  objects. Normalize that comparison using native structuredClone, which retains
  holes, undefined, aliases, and cycles instead of JSON normalization.
- Corrected RED, before production edits: 14 failures / 5 passes. Sparse cases
  throw `TypeError: undefined is not iterable`; metadata/raw cases lose named
  entries. Keep both RED logs.
- GREEN: 19 / 19 focused tests; 1,732 / 1,732 adjacent tests in 50 files.
- `env -u TERM npm test`: 21,571 passed / 41 skipped in 937 passing / 3 skipped
  files, uncached. No failing tests or timeouts.
- Required dependency build and full `npm run build`: pass.
- Package `tsc --noEmit`, root `npm run lint:types`, `npm run lint:eslint`,
  `npm run lint:workflows`, changed-file Prettier, and `git diff --check`: pass.
- Initial type-check attempts overlapped a build that removes dependency `dist`
  trees. They failed with unresolved workspace imports and consequent inferred
  type errors. Both pass after that build completes, without code changes;
  retain both failed and successful logs.
- Repository-wide Prettier reports 1,442 files, all unchanged from HEAD. None is
  a deliverable file. Preserve its failed exit and complete path list; do not
  reformat unrelated code.

### Untouched originals

The retained full `03-codec-workflow.ajs` is byte-identical to the allowlisted
original (SHA-256
`bc1549cad586b27c49963fe017e9a286c9b87a4463425d14034998a838827844`).
No dense rewrite is substituted. The original native and SafeJS host drivers
from the allowlisted results artifact are reused with recorded argv, bounded
memory, wall-time, and interpreter budgets; host operations are pure stubs.

- ASCII and Unicode fixtures pass native and base uninterrupted execution.
- Base automatic capture reports four sparse traversal failures per fixture;
  its one retained terminal snapshot is not a successful sparse intermediate
  checkpoint.
- Patched uninterrupted/capture outputs exactly equal native full outputs.
  Eight intermediate checkpoints serialize without backend errors.
- Every intermediate boundary resumes twice: 16 / 16 full output and final
  journal comparisons pass. Each stored sparse lookup has length 123 and 66
  present keys, without filling its holes.
- Four completed-snapshot resumes pass, including two produced by the untouched
  base runtime, with zero host calls.
- The original clone reduction passes dense, all-hole, and sparse-value cases
  against native after the fix; both sparse cases failed on the base runtime.

### Separate metadata observation

The supplied `checkpoint-metadata-control.json` is retained separately. The
exact original control now returns keys `0, metadata, raw`, with array, indexed,
named, and object aliases intact. The indexed-only old representation and
array-only reference traversal explain both this omission and sparse shape
loss; the remedy therefore belongs to the same serializer representation.

Four separately named regressions cover metadata/raw and named-only aliases,
cycles, and undefined across the interpreter serializer and public dump. This
does not resolve or claim all array-own behavior: non-enumerable properties,
descriptor flags, symbols, accessors, frozen/sealed state, and unrelated array
operations remain outside this fix. Old dense records remain readable; old
runtimes are not claimed to read the new sparse/named representation.

### Handoff

The ignored evidence root is `out/safejs-remediation/obj-002/`; its manifest
indexes exact file hashes, preimages, the patch, full stdout/stderr/argv records,
all failed checks, and scope limits. Publishables, preimages, and evidence are
sealed read-only with macOS immutable flags. No commits, pushes, branches,
README additions, CLI visual changes, or other-clone edits are made.

The local `.git/info/exclude` ignores only this evidence root. The standard
build also generates four untracked font assets under
`packages/terminal-pilot/assets/`; they are not part of the patch. Independent
validation is pending and must not be inferred from this author result.

## Author-test typing repair — 2026-08-29

Noether's independent runtime/configured-gate candidate identified 15 supplemental
diagnostics in the author-owned `snapshot/array-shape.test.ts`. They were genuine
new test errors, not waived because the configured source gate excludes tests.
The Noether report and validator test remain unchanged; its recorded open item is
historical evidence, not a rereview of this repair.

Parent candidate manifest:
`out/safejs-remediation/obj-002-validation/candidate-20260829-obj002-noether/manifest.json`,
SHA-256 `396ca23c1518e0b6ee8d608fcce41bdb2a184f4101146f4194ff6c4a0950c057`.
The previous author capture and this independent capture remain immutable.

### Repair rationale

Only the author test and this appended plan section change:

- Read the parsed node ID into a local and reject an absent ID before constructing
  the serializer fixture. This narrows the actual optional parser result instead
  of asserting a type that the fixture has not established.
- Read restored bindings through a test-local helper that checks `found` before
  returning `value`. A present binding whose value is `undefined` remains valid;
  the helper rejects missing bindings, not undefined values.
- Keep all fixtures, test names, expected values, matcher calls, and test counts.
  A TypeScript-AST comparison verifies all 31 static matcher calls are identical
  after normalizing the guarded binding read to its previous lookup expression.
- Add no TypeScript suppression, new assertion cast, skip, reduced validation
  scope, compiler configuration change, or production complexity for tests.
  All six production files and both validator files remain byte-identical to
  Noether's captured publishables.

### Supplemental RED / GREEN

Run the exact same command before and after the repair:

```text
env -u TERM node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict packages/safejs/src/snapshot/array-shape.test.ts
```

The inherited flags, including `--skipLibCheck`, are unchanged. RED exits 2 with
15 diagnostics: three `TS2345` optional-node-ID arguments and twelve `TS2339`
un-narrowed lookup values. GREEN exits 0 with **zero diagnostics**, including
zero author-owned diagnostics. Exact argv, complete diagnostics, stdout/stderr,
and exit codes are retained. The corresponding unchanged validator-file command
also exits 0.

### Runtime and configured checks

- Author plus independent focused tests: **36 passed**, two files.
- Adjacent snapshot/interpreter/run/restore/dump tests: **1,749 passed**, 51 files.
- Configured package and root types, root ESLint, workflow lint, formatting of
  both repair-owned files, and `git diff --check`: pass. No production rebuild is
  necessary for this test-only repair; no dependency or compiler configuration
  is changed.
- The complete `env -u TERM npm test` gate passes: **21,588 passed / 41 skipped**,
  938 passing / 3 skipped files, one uncached Turbo task, 3m46.676s.
- Noether's repository formatting command, with `!out/**`, still reports 1,432
  unchanged files (exit 1). No warned file is repair-owned, modified, or new.
  The failure and full path list are preserved without unrelated formatting edits.
- No original audit payload is accessed or changed in this follow-up. Original
  workflow results remain those in the unchanged prior captures, not newly
  claimed independent runs. No security work, guest IO, or real LLM call is added.

### Fresh handoff

Fresh evidence, immediate repair preimages, candidate files, and the manifest live
under
`out/safejs-remediation/obj-002-author-test-typing/candidate-20260829-obj002-author-types/`.
The candidate includes all ten publishables, with only the two author-owned files
changed from Noether's candidate. Existing immutable captures are not overwritten.
Separate Noether rereview is required; this repair is an author result, not an
independent approval or an expanded array-own compatibility claim.

## Current-main three-way integration — 2026-08-29

This is a directly delegated integration-author result, not the later independent
merged validation. The original sparse-checkpoint clone and all its captures are
read-only inputs. Only this integration proof is appended to the incoming author
plan; both test files and the complete Noether report remain byte-identical.

### Pulled base and incoming candidate

- New clone:
  `/Users/kjopek/Workspace/poe-code-safejs-sparse-checkpoint-integrated`.
- Origin inherited from `poe-code-safejs-publish`:
  `git@github.com:poe-platform/poe-code.git`.
- Immediately after cloning main, run `git pull --ff-only origin main` before
  inspection or edits: already up to date, clean initial worktree.
- Current integration base: `f5dc9facc00e03fd2ade2af650b25bda7dc43068`.
- Verified ancestor: ARRAY commit `7fec2826bac2933483c2579ff47d2264f8e1f422`,
  tagged `v11.0.9`. The newer base also contains the COLL test-fixture type repair.
- Incoming frozen manifest:
  `out/safejs-remediation/obj-002-validation/typing-rereview/candidate-20260829-obj002-noether-types/manifest.json`
  in the original sparse-checkpoint clone, SHA-256
  `d075457f0b3e77f3360b372a54132221c02b93153a221ffe86d7dae639af276e`.
- Verified all ten incoming publishables, five historical base preimages, and
  three typing-repair preimages before integration. Current-base preimages and
  explicit absent-file records were captured before edits.

### Three-way application and preservation

Compare the incoming historical base `33c73a21fb01875b0e2297ccac955974a0889991`,
the pulled current base, and the incoming publishable bytes. The five modified
target modules have identical historical/current preimages, despite intervening
upstream changes elsewhere. There are **zero textual conflicts** and no manual
overrides of upstream changes.

Apply 18 minimal `apply_patch` hunks across `graph-depth.ts` and snapshot
`serialize.ts`, `dump-format.ts`, `restore.ts`, and `validation.ts`; add the missing
array helper rather than replacing current modules wholesale. Add both unchanged
test files and both incoming plans with `apply_patch`. All ten files initially
match the incoming candidate exactly. Only this author-plan appendix subsequently
differs from the incoming bytes.

All 37 existing source/plan files changed upstream since the historical base
retain their pulled-base hashes. No other tracked file changes. A dedicated
20-file published-test matrix retains ARRAY own-property/call-order, COLL cursor
iteration and its type repair, OBJ001 aliases, MC003 constants, MC001 globals,
TREE contextual parsing, HI Markdown offsets, and STR03 replacement regressions.
Those upstream implementations and assertions are not patched.

### Genuine current-base RED and merged GREEN

Run the unchanged author and Noether tests against actual pulled current
production before adding the helper or applying any production hunk. No old
runtime checkout, in-memory preimage substitution, or source adaptation is used.

- Current-base RED: **26 failed / 10 passed**, 36 tests. Sparse graph traversal
  throws and the named metadata/raw checkpoint graph loses entries.
- Merged GREEN: **36 passed**, identical tests and assertions.
- Expanded adjacent suite: **1,925 passed**, 55 files (the earlier candidate's
  1,749-test neighborhood now also contains published upstream regressions).
- Dedicated published-feature matrix: **1,254 passed**, 20 files.
- Full `env -u TERM npm test`: **21,977 passed / 41 skipped**, 949 passing /
  3 skipped files, one uncached Turbo task, 3m29.087s.
- `SKIP_SYNC_SKILLS=1 npm ci`, current-base full build, and merged
  `env -u TERM npm run build`: pass. The merged build completes all 67 tasks.
- Both exact supplemental commands from Noether, independently targeting
  `array-shape.test.ts` and `obj-002-validation.test.ts`, exit 0 with **zero
  diagnostics**. Their flags remain unchanged:
  `--noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --strict`.
- Configured package/root types, root ESLint, workflow lint, all ten publishables'
  formatting, and `git diff --check`: pass after the completed merged build.
- Repository-wide formatting, with `!out/**`, exits 1 for **1,435 unchanged
  current-base files**. No warned file is a merged publishable or an untracked
  addition. The full warning list is retained; unrelated formatting is untouched.

### Untouched originals and exact metadata/raw witness

Before original payload access, bootstrap all 38 exclusions from
`inventory-verification.json` and exclude the entire `security/` tree. The only
allowlisted audit inputs are `objects/reductions/structured-sparse.ajs`,
`checkpoint-composition/03-codec-workflow.ajs`, and
`checkpoint-composition/results.json`. No recursive archive search or excluded
read, hash, or execution occurs. The separate immutable metadata observation is
read-only. Hashes are checked again at handoff.

The original codec workflow remains byte-identical, SHA-256
`bc1549cad586b27c49963fe017e9a286c9b87a4463425d14034998a838827844`.
Reuse its original pure deterministic host drivers and full source, not the dense
rewrite. Child wall-time and memory bounds remain 10 seconds / 192 MiB, with
200000 steps, call depth 128, string length 65536, array length 2048, and data size 4000000. Native expectations are established first.

- ASCII and Unicode current-base uninterrupted results match native. Both
  current-base captures report four serialization errors; a late terminal write
  does not count as a successful sparse intermediate checkpoint.
- Merged uninterrupted and captured outputs, host calls, and outcomes exactly
  match native for both fixtures. **Eight** intermediate checkpoints serialize
  without errors; each preserves lookup length 123 with only its 66 present keys.
- Resume every intermediate boundary twice: **16/16** return values, outcome
  ledgers, and final journals pass. Additional equality checks verify the complete
  journals, including call IDs, without dropping fields.
- **Four** completed-snapshot resumes pass, including two produced by the pulled
  current base. All return native values, preserve complete journals/outcome
  ledgers, and make zero host calls.
- Original dense, all-hole, and sparse-value clone reductions match native after
  merging; both sparse reductions fail on the pulled current base.
- Execute the exact retained metadata/raw control and a real native
  `structuredClone` graph control. Current base retains only key `0`; merged and
  native retain `0, metadata, raw`, with array, indexed, named, and object aliases
  intact. This remains the same separately recorded representation root, not an
  all-array-own fix.

No guest IO, real LLM calls, or new security work is introduced. Unit tests remain
the incoming in-memory tests; evidence files are host-side outputs. Existing
configured guard tests are not a new security investigation. No CLI visual
surface changes, README additions, branches, commits, pushes, or other-clone
writes occur. Build-generated font assets are not publishables.

### Integration handoff boundary

Freeze exactly the ten merged publishables, current-base preimages and absences,
incoming/historical/typing preimages, patch, original outputs, and every command
record under ignored `out/safejs-remediation/obj-002-integration/manifest.json`.
The manifest records hashes and immutable capture flags. The prior author and
Noether captures are not rewritten, and their approval is not transferred to
this different base.

Separate independent merged validation remains required. Checkpoint preservation
is still limited to supported enumerable own data: descriptor flags,
non-enumerables, symbols, accessors, old-reader compatibility with new records,
and unrelated array behavior are not newly claimed. Pending regex key-order and
ordinary-host-getter differences remain separate. ARRAY live own-property and
call-order behavior and COLL cursor behavior remain the published upstream code.

## Ordered NUM001 then OBJ002 integration — August 29, 2026

### New base and separate prerequisite

Work directly in the new main clone
`/Users/kjopek/Workspace/poe-code-safejs-sparse-checkpoint-ordered`.
Clone from the publisher origin and immediately run `git pull --ff-only origin main`
before recording or editing source. The pulled base is
`afe59a77fa318acf72162a1970306147fdfc5428`; it contains ARRAY commit
`7fec2826bac2933483c2579ff47d2264f8e1f422`, tagged `v11.0.9`, plus the published
IP002 parser and OBJ003 module-namespace fixes. Read the workspace and clone
AGENTS instructions. The older sparse, integrated, arity, and publisher clones
remain read-only.

Verify the approved NUM readiness record and its eleven-file manifest SHA-256
`d3e8d605c2a93ee2db22c16c6cc1acc66db373927aafbb23a25b7e7396fc234e`.
Verify the Noether first-merge OBJ candidate manifest SHA-256
`bc3108c62b4b9106f50bd5f7ad2b597870c2a5460fe4a2993a7841472200febe`.
All seven existing NUM preimages and all five existing OBJ preimages match the
pulled main bytes; new-path absences also match. Stage the eleven approved NUM
files using minimal `apply_patch` hunks, with every staged postimage byte-identical
to its approval. This is a separate prerequisite, not part of the ten OBJ files.
Record the five OBJ preimages again after NUM is present.

### Three-way merge and preservation

The only shared path is `packages/safejs/src/snapshot/restore.ts`. Its post-NUM
preimage SHA-256 is
`e1fbab08bc2f6bd6b1fbdf3c50626909ff4d57068053cf6bdd08a9a8f1e6819a`.
Apply only OBJ's array allocation/entry-restoration hunk to that file. Keep NUM's
`getFunctionLength` import and source-closure length initialization unchanged;
default/rest parameter handling and bound-function restoration are not replaced.
The merged file SHA-256 is
`659ad4fecb728508c12520edb1fede88ba56a10a88650e0ded53969acb8dcc03`.
The result equals `git merge-file -p` of post-NUM, shared base, and incoming OBJ:
zero conflicts, no whole-file overwrite. Other OBJ production hunks apply cleanly.

Both OBJ test files, both NUM new test files, the approved NUM changes to existing
tests, and both published validator reports retain their exact approved bytes.
No assertion, fixture, selector, or validator report is edited. Only this author
plan gains an appendix. The prior 15-to-zero author-test typing repair is retained,
not replaced by a suppression or a narrower gate. All ten NUM-only paths remain
byte-identical after OBJ integration. Thirty-seven prior published paths are
checked against main, including ARRAY, call order, COLL cursor, OBJ001, MC003,
MC001, TREE, HI, STR03, IP002, and OBJ003 paths.

### Ordered RED and combined GREEN

Run the unchanged OBJ tests before its production delta, with NUM already present:
**26 fail, 10 pass**. The sparse graph-depth failure and named metadata/raw loss
remain genuine prerequisite-only failures. NUM's unchanged selected gate already
passes **96 tests**, retaining its historical 26 exclusions.

After the OBJ merge:

- Unchanged OBJ focus: **36 pass**, zero failures.
- Unchanged NUM selected focus: **96 pass**, the same 26 excluded names. An
  additional unfiltered run of all four NUM files passes **122/122**; those 26
  tests are not missing from the combined full gates.
- Adjacent snapshot/interpreter/run/restore/dump gate: **1,977 pass**, 57 files.
- Published regression matrix: **1,416 pass**, 24 files.
- Entire SafeJS package: **4,806 pass, 39 skipped**, 165 passing files and one
  skipped file.
- `env -u TERM npm test`: **22,191 pass, 41 skipped**, 955 passing files and three
  skipped files; one successful uncached task, 4m25.462s.
- Both exact supplemental OBJ TypeScript commands pass with zero diagnostics.
  The unchanged NUM configured-program command adding its two new test roots also
  passes with zero diagnostics. Configured SafeJS and root source types pass.
- Configured ESLint, workflow lint, and all 17 package-lint rules pass. All 20
  unique publishable paths pass Prettier; `git diff --check` passes.
- Install with `SKIP_SYNC_SKILLS=1 npm ci`. Both prerequisite and combined
  `env -u TERM npm run build` runs pass all 67 tasks. Builds finish before type
  checks or original-runtime drivers start.

The repository-wide format check remains exit 1 with **1,435 unchanged baseline
warnings**. Its exact command, output, warning paths, and proof of zero warned
tracked/untracked candidate changes are retained. Do not repair unrelated
formatting. NUM's historical expanded four-test typing limitation remains in its
unchanged report; this handoff does not relabel that historical gate as passing.

### Original and cross-fix evidence

Before original archive payload access, install the 38 exact exclusions from
`inventory-verification.json` plus the entire security-directory prohibition.
Use only the explicit two OBJ sources, three NUM source paths, and the OBJ
protocol results file; the resulting allowlist has six paths total.
The metadata bootstrap itself is not an algorithm payload. A provenance-ordering
disclosure is retained: while identifying NUM's exact filenames, approved native
and current command captures exposed their three embedded nonexcluded sources
after the exclusion guard but before those names were added to the local
allowlist. All direct archive payload reads occur after the complete allowlist
is recorded. No excluded file is read, hashed, or executed; there is no recursive
archive search. Hash the six permitted originals before and after. Their bytes
remain unchanged. AST extraction verifies that the NUM driver's three embedded
sources equal those exact guarded originals.

Execute the unchanged full codec workflow with the original pure deterministic
host protocol. ASCII and Unicode prerequisite-only uninterrupted results match
native, but each capture reports four intermediate serialization errors. Combined
execution captures **eight** real boundaries, each retaining lookup length 123
and exactly 66 present keys. **Sixteen** intermediate resumes and **four**
completed resumes match native whole values and outcome ledgers; whole final
journals include call IDs without field projection. Completed snapshots include
two produced by the NUM-only prerequisite, and all completed resumes make zero
host calls. Dense, all-hole, and sparse-value original clone reductions match
native after integration; both sparse cases fail before OBJ.

The exact retained metadata/raw checkpoint witness and a real native graph clone
both retain keys `0, metadata, raw`, including array, indexed, named, and object
aliases. The prerequisite retains only key `0`. This remains the separately
recorded array-representation observation, not an all-array-own compatibility claim.

All three full NUM originals run twice natively, twice currently, and twice from
completed snapshots: six native anchors, six current results, and six replays
match whole outputs. Descending bisector rows remain
`[[5,7,5],[3,5,3],[1,2,1]]`. The approved two active-checkpoint arity controls also
match native and replay, without changing their sources or assertions.

An additional bounded pure cross-control checkpoints a sparse length-five array
containing source functions, a pre-bound function, explicit undefined, metadata,
raw, aliases, and a self-cycle. Native, current, and two restored executions agree
on keys `1, 3, metadata, raw, self`, own-presence flags, aliases, arities
`[2,2,2,1,1,0]`, zero default evaluations before invocation, and exactly two after.
No production complexity or permanent test file is added for this control.

Preserve ad hoc driver failures separately: an initial embedded-JSON boundary scan
stopped at a semicolon inside a source string; AST extraction corrects the driver.
The initial new cross-control used unsupported binary `in`; the retained diagnostic
retry identifies `UNSUPPORTED_NODE`. The supported control checks the same five
own-presence positions using `Object.hasOwn`. No existing test or validator
assertion is changed, no unsupported-operator fix is claimed, and both failed
cross-control outputs remain evidence.

### Ordered handoff boundary

Freeze the eleven-file NUM prerequisite and its seven current-main preimages
separately from the ten merged OBJ postimages and five post-NUM preimages under
ignored `out/safejs-remediation/obj-002-ordered/manifest.json`. Include separate
NUM and OBJ patches, explicit absent-path records, parent manifest hashes, original
outputs, all command records, and exact merged file hashes. Check forward and
reverse patch applicability against the appropriate captured stages. Captured
files and directories are read-only and macOS immutable; live working files stay
editable. Existing captures are never modified.

No README edits, inline comments, branches, commits, pushes, other-clone writes,
guest IO, real LLM calls, new security work, or publication occur. Build-generated
font files are not publishables. This is author evidence only; fresh Noether
combined review remains required. Supported enumerable own data, holes, lengths,
aliases, and cycles are covered; descriptor flags, non-enumerables, symbols,
accessors, old-reader compatibility, and unrelated array-own behavior are not
newly certified.
