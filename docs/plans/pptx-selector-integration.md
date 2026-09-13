# PPTX selector integration and QA

Scope: the selector task in the proposed PPTX plan. This is not execution of the
whole pipeline or a claim of presentation-editing/public-model API parity.

## Ownership

- Selector worker: package selector engine, original SDK cases, exports and usage draft.
- Adapter worker: explicit safe-bash command, original shell cases and necessary
  explicit injected engine boundary.
- Evidence worker: independent upstream case accounting and implementation review.
- Root: dependency/export metadata, review, disposable corpus QA, local commits.

Existing unrelated changes, including the larger pipeline plan, remain untouched.
No README changes, default command registration, push or release are authorized.

## Checks and manual QA procedure

1. Establish failing original cases before each implementation change. Run the
   maintained `pptx` workspace unit and lint routes and the selected workspace
   build closure. Exercise the adapter through its maintained focused Node test
   route; verify its declared dependency admission and built public export.
2. Inspect SDK and CLI identity values independently: relationship order must win
   over filenames, shape IDs must be scoped to their owner, ambiguous names must
   report candidates, and invalid/stale selections must fail with the shared
   result/status contract.
3. Read `docs/pptx/corpus-manifest.json`. Select an already cached small fixture;
   verify its SHA-256 against the manifest before admission. Read it only through
   an explicitly supplied QA byte buffer. Compare slide IDs/order and shape IDs
   with an independent XML/ZIP inspection. Do not modify or commit corpus bytes.
4. Inspect help and error output as terminal screenshots. The root poe-code
   screenshot route cannot invoke an unregistered optional shell command; capture
   actual optional-command output with the terminal PNG renderer instead.
5. Reduce any meaningful finding to small original in-memory XML/ZIP data and
   repeat red/green checks. Keep the QA procedure and evidence in this document,
   never a committed QA runner.
6. Commit each verified atomic improvement on `main`, staging only named owned
   files. Report local hashes separately; do not push or release.

## Evidence

- Baseline: `npm run test:unit --workspace=pptx` passed 415 tests in 12 files.
- Dependency metadata was refreshed offline with
  `npm install --package-lock-only --ignore-scripts --offline`; the lockfile delta
  contains the SDK hash and test-schema dependencies and the root's explicit `saxes`
  runtime dependency for shipped presentation code.
- Root runtime wiring gained a failing original memfs assertion for an unresolved
  `pptx` import, then passed all 12 bundle/runtime/declaration rewrite checks.
  The SDK-to-shared-codec import is rewritten to shipped relative files.
  Root exports only point at package implementations; the adapter takes an
  explicitly supplied SDK engine.
- Root `lint:types` and `lint:workflows` passed. Initial package dependency lint
  correctly found the not-yet-rewritten built adapter import; final root bundle
  and repeated package dependency lint remain required.
- Corpus: the manifest-listed `IXPE-Presentation-Template.pptx` was verified as
  SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  Independent test-only ZIP/XML inspection found slide IDs
  `256, 258, 259, 257, 260`, with slide object IDs respectively
  `[3,6]`, `[2,3,4,5,6]`, `[2,3,4,5,6,7]`, `[10,7,8,9]`, `[2,3,4]`.
- The first product corpus admission failed on opaque extension payloads. An
  original in-memory regression now preserves these payloads and skips their
  semantic traversal while retaining required-namespace checks. After the fix,
  SDK output exactly matched the independent fingerprint, ordered slide IDs and
  all five object-ID lists. Every slide token round-tripped. The index contained
  23 graph parts and 58 objects across all explicit scopes. No corpus bytes were
  edited, downloaded, copied into tests, or staged.
- `npm run build` passed: 73 declared workspace builds, followed by the maintained
  root code-generation/type/bundle stages. One workspace has no declared build;
  it was reported as such, not counted as a passing build.
- Built `poe-code/pptx` and `poe-code/safe-bash/commands/pptx` imports resolve.
  The optional Shell CLI also inspected the admitted corpus through an explicit
  in-memory VFS and returned the independently expected five slide IDs.
- Inspected `/tmp/pptx-selector-cli.png` (actual help and usage errors) and
  `/tmp/pptx-selector-inspect.png` (successful corpus inspection). Text is readable
  and not truncated; screenshots remain disposable and unstaged.
- Repository-wide ESLint passed with zero errors/warnings; 11,846 configured
  inputs were linted. Changed package lint and the focused metadata lint passed.
- The initial full test route found two exact root metadata inventory assertions
  needing the newly added exports/dependency. Updated the explicit expected
  inventory without weakening it; all 21 metadata tests then passed. That run had
  23,839 other passing tests and two intentional skips; it was not a successful
  full gate. A concurrent maintained rerun found one further exact safe-bash
  dependency inventory assertion, then reported a cleanup `kill EPERM` after
  that failure. The inventory was corrected and all 504 maintained runner tests
  passed. A later full rerun used the default sequential mode; its archive
  failures and replacement run are recorded below.
- Schema coverage was strengthened from structural assertions to 25 independent
  accepted/rejected query cases using a test-only declared schema-validator
  dependency. Product runtime dependencies are unchanged by that test improvement.
- Final full unit rerun and post-bundle dependency lint remain pending.

- The third full unit run passed the root shared suite (23,841 tests, two
  intentional skips), Python (29) and the safe-bash runner (504), then exposed
  a hard dependency conflict with sealed archive-admission checks. The run was
  intentionally stopped with SIGTERM after the failures. It is not a full pass.
  Domain command execution now moves into the PPTX package, supplied explicitly
  to the safe-bash byte-I/O adapter. The adapter gains no new runtime dependency.
  This keeps sealed registry/source provenance guards unchanged. Only task-owned
  hard-dependency admission edits are removed; existing archive rules are retained.

- Final injected-engine verification: 104 independently rerun focused SDK
  cases and 21 real SDK-backed Shell cases pass. All 205 existing archive
  controls pass unchanged. Package lint and changed wiring/adapter ESLint pass.
  The final full route is `npm test -- --concurrency=4`, uncached and without
  exclusions. A last diagnostic-code fix landed immediately after that route's
  build closure; the maintained exact `pptx` build closure refreshed it before
  the CLI cases ran. The stale-build CLI failure was rerun to 21 passing cases.
- Built public imports were exercised again with the injected engine: exact
  manifest fingerprint, all five slide IDs and independently enumerated shape
  IDs match. An initial QA import used a nonexistent memory-filesystem subpath;
  the documented root safe-bash export supplies `MemoryFileSystem` correctly.
  Final screenshot `/tmp/pptx-selectors-final.png` was rendered from actual help,
  five-slide output and malformed-part usage failure, opened and inspected.
  Output is readable without clipping. No fixture or screenshot is staged.

- Packed consumer QA used a disposable local tarball after the normal build and
  final bundle refresh, without release or installation. The 5,913-file archive
  contains the SDK, explicit adapter and standalone package license; it contains
  no `.pptx` files or corpus-cache paths. In an isolated extraction, with only
  copies of the declared hash/compression/XML runtime packages and the XML
  parser's transitive dependency, public `poe-code/pptx` and optional adapter
  imports resolve. Actual Shell schema discovery and pre-I/O invalid-part
  status/code checks pass. No workspace source fallback or package symlink was
  supplied to this consumer.

- The full route without a revision selector reached the clean packed-revision
  check and failed its metadata precondition: committed HEAD predates the new
  package exports and test dependency. Standalone reproduction failed before
  compilation at `verify.mjs:153`, with no execution steps. Following the
  existing procedure in `docs/plans/pptx-zip-reader.md`, a private temporary Git
  index captured only the 24 explicitly owned paths into unattached nonempty
  QA object `4ecf610fe225216e38fd417096b9f7b4f593fdee`. This does not move main or
  modify the real index. The source, root metadata and lock are admitted by the
  unchanged verifier using that explicit revision. This object is QA evidence,
  not a main commit, push or release.

- Direct verification of QA revision `4ecf610fe225216e38fd417096b9f7b4f593fdee`
  passed clean packed imports, no network/credential calls, source-boundary
  denials and strict public TypeScript checks. All 19 owned source/config/test
  inputs were compared byte-for-byte with that revision after execution; only
  final documentation receipts change afterward.

- The first final full run completed safe-bash with 37,682 passes, 823 skips and
  exactly the one HEAD-metadata precondition failure. Root/shared had 23,852
  passes and two skips; shell-runner had 499 passes. Failure cleanup reported
  `kill EPERM`; process inspection confirmed that its children had exited. The
  SafeJS run was interrupted, so no completion is claimed for it. The corrected
  complete invocation is `S3_HTTP_EXPORTS_REVISION=4ecf610fe225216e38fd417096b9f7b4f593fdee npm test -- --concurrency=4`,
  with the selector scoped by the maintained runner to virtual-bash only.

Packed declaration QA procedure: in the same isolated extraction, stage only
Node consumer type dependencies and author a temporary consumer of the public
SDK and injected Shell plugin. Run the maintained installed TypeScript compiler
with strict NodeNext resolution and no emission. Include expected type errors
for missing JSON coordinates and a missing injected engine. No workspace source
paths or source aliases are available to this consumer.

The isolated strict TypeScript consumer passed with no diagnostics. Both
expected negative cases were enforced: omitted JSON coordinate systems and
omitted adapter engines are rejected. The consumer used packed declarations
and copied declared runtime/Node type dependencies, without source fallback.

- The corrected full run completed safe-bash with 37,683 passing tests, zero
  failures and 823 intentional skips. Its packed-revision test admitted the
  explicit immutable QA revision. Final maintained PPTX workspace checks also
  passed all 482 tests in 15 files and its ESLint/production/test type checks.

## Final qualification

The corrected complete maintained route exited zero. Results: root/shared
23,852 passed / two skipped; Python 29 passed; shell runner 499 passed;
safe-bash 37,683 passed / 823 skipped; SafeJS 28,932 passed / 47 skipped;
terminal-pilot 288 passed; native posttest lint stress two passed. The maintained
planner discovered 74 workspaces, selected five build dependencies and 43 unit
tasks, ran uncached with concurrency four and excluded none. Workspaces without
a declared unit task were explicitly reported unavailable, never counted as
passes. The configured revision was scoped only to the actual virtual-bash
unit task. The root bundle suffix is refreshed after the unit build closure,
then shipped dependency closure is checked again before the local main commit.

This completes the selector/inspection slice. The created-object handle registry
is tested, but editing, batch execution/serialization and the full model API
remain pending in the larger plan. No README, corpus fixture, unrelated plan or
sealed provenance rule is changed. No push or release is performed.

Final bundle refresh and all three shipped/runtime dependency lint rules passed. The 19 owned source/config/test inputs still match the qualified immutable revision exactly; only final documentation receipts differ.
