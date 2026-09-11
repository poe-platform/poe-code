# Release integration: September 9, 2026

## Requested outcome

The user explicitly authorizes pushing and releasing the completed changes and
prioritizes issue 687 (zip/unzip) next. The macOS issue remains skipped. Release
the existing fixes before starting ZIP implementation; source-only ZIP preparation
may proceed while release integration runs.

## Merge inputs and ownership

The clean local main at `1dd189f31` contains 20 commits beyond the common base.
Fetched remote main `dd4087fc2` contains 16 different commits. Merge both histories
without force-pushing, discarding either parent's changes, or creating a branch.
Root owns Git, package/bundle integration and publication. Independent workers
resolve exact command inventories and review the owned child-input helper.

The combined command inventory is 89: the historical 82 plus five local utilities
and the remote xq/xmllint pair. Independently declared arrays, frozen fixture
partitions and custom-command totals must retain all members rather than derive
their expectations from the implementation under test. Preserve remote grep,
XML/TOML and workerd support alongside local truncate and native retained seeking.

## Validated integration findings

- The initial merge reports 24 conflicted paths; conflicts are resolved by
  preserving both applicable behaviors and tests, not wholesale parent selection.
- The owned-input helper keeps remote fd3 support and both parents' reset tests.
  EPIPE/ECONNRESET is benign only for owned input streams; output errors stay fatal.
  Its focused unsandboxed suite passes 40 cases with no skips or failures.
- Three focused bundle/package test files pass 16 tests, retaining native-loader
  externalization and combined Node/workerd publication coverage.
- The first full build detects a silently auto-merged duplicate `imports` key in
  the SafeJS manifest. Parsing hid the native mapping behind the remote platform
  mapping. Deep-merge the two parents' import maps into one object, preserving
  every mapping and guard. A JSON AST check rejects duplicate keys in all affected
  package scopes; no guard is weakened to accommodate the error.
- The corrected normal build passes all declared workspace/root stages. Independent
  review finds no validated regression in the native/workerd bundle union: private
  native imports remain blocked in workerd/browser, standalone packaging preserves
  both routes, and combined publication retains reachable canonical chunks.

## Release gates

Run the normal build, complete maintained unit route, repository lint and Bash
consumer typecheck against the merged candidate. Keep original failures beside
corrections. Verify the committed source and clean worktree at gate boundaries.
Fetch again before a normal non-force push; if remote advances, integrate it
instead of overwriting it. Verify remote main contains the delivered commits and
monitor the actual release through successful publication. A local merge or
successful push alone is not a successful release.

Evidence for this integration is under `out/release-20260909-merged/`; process
helper evidence is `/tmp/retained-child-input-merge.5rWQG6/`. Earlier local-only
gate receipts qualify their own revisions, not this merged candidate.

## Final integration checks

The complete maintained `npm test` route passes at merge commit `a15cffe1b`,
including its native pre/post stages. Root lint, the corrected normal build,
focused bundle tests and merged command inventories also pass. The first Bash
typecheck retains one failure in the remote TOML parser fixture: strict generic
inference cannot represent its heterogeneous expected-object union, including
prototype-named keys. Explicitly selecting `unknown` for the assertion generic
preserves every input, expected value and runtime assertion; TypeScript 5.9.3
emits byte-identical JavaScript before and after this annotation. The focused
parser test passes all 37 cases, maintained Bash typecheck passes all 26 current
consumer groups and source/tests, and root lint passes with no errors or warnings.
Receipts are `toml-type-fix-runtime-v1`, `toml-type-fix-emission-v1.json`,
`typecheck-v2` and `lint-v2` under the integration evidence directory.

## Final remote delta

The pre-push fetch discovers remote `8c186cf47` (UTF-8 grep subjects). Commit
`a918b51aa` merges it without conflicts after the type-only correction. Independent
review finds no concrete regression; the two overlapping inventory/browser
fixture edits are disjoint and preserve the local utilities. The maintained
focused regex/grep/consumer runtime cohort passes 457 tests, and authenticated
test-inventory checks pass 100 tests. The normal build and all maintained Bash
typechecks pass again (`build-v3`, `typecheck-v3`).

Fresh scoped tarballs from this candidate pass the maintained installed Node and
Bun smoke fixtures, public TypeScript consumer and browser-platform bundle
fixture. The latter is executed in Node as in CI, not claimed as a new real-browser
run. Temporary npm 11 packs and installs with lifecycle scripts disabled; no
publication occurs locally. Evidence is `/tmp/poe-release-final-packed.Trc8VR`,
also recorded in `packed-v1.path`. The earlier full unit run qualifies the first
merge; these focused checks qualify the additional remote delta and unchanged
runtime output of the type annotation. Remote CI still validates the final SHA.
Final root lint (`lint-v3`) also passes all 10,506 configured inputs, root
TypeScript and workflow lint with no errors or warnings.

## Delivered candidate and release-check correction

Remote main is verified at `adc4d5b8e8ff60fe95ccc80e37aead59b47f3dcc` after a
normal push. Validated utility issues 674–678 are closed after remote delivery.
Scoped workflow 34395450065 publishes SafeFS, SafeJS and Safe Bash 0.1.513 with
provenance. Root workflow 34395450680 fails its packed smoke check, not a utility
test: serialized native-asset facts intentionally lose their in-process authority.

The same packed smoke command reproduces the failure locally (`root-smoke-red-v1`).
Refreshing facts initially still fails (`root-smoke-green-v1`, despite its attempted
green label): the root tarball omits the collector's source/provenance inputs.
Include exactly the registry, C source, original loader and declaration in its
packlist. Authenticate installed bytes with the existing bounded collector and
real metadata, then overlay its fresh facts before policy validation. Do not trust
serialized facts, weaken private-import guards or authenticate checkout binaries.
The temporary smoke consumer explicitly installs the current compiler version
needed by the collector; production dependencies do not change. Its unit
expectation is first red (`root-smoke-compiler-red-v1`), then green.

The corrected complete packed CLI/SDK smoke passes (`root-smoke-green-v2`), and
smoke-runner/native-authentication tests pass 114 cases (`root-smoke-unit-v2`),
including existing serialized-fact, missing/tampered-asset and path controls.
Keep the failed release and both local failures as evidence; push the narrow
correction and monitor the new root release through actual publication.
Final root lint (`root-smoke-lint-v2`) and all 17 package-lint rules pass.
The repaired smoke consumer contains explicit QA TypeScript tooling; its success
does not independently certify a TypeScript-free production dependency graph.

## Subsequent remote changes and aggregate-test correction

Repair `b41b3dd22` is verified on remote main. Its scoped release publishes
0.1.514, and its root packed check passes in CI. That root run is subsequently
canceled rather than completing publication. New remote main `1e21b143e` retains
the repair and adds lint-cache maintenance plus ASCII case-insensitive grep.
Fast-forward the clean local main without discarding either change.

The newer release 34398882314 exposes two stale aggregate-route assertions:
`grep -i a` is now supported but the tests still expect status 2. Reproduce the
exact two failures locally after the current build is restored (22 pass, 2 fail).
An earlier attempt during the build failed module loading and is retained as
separate evidence, not counted as the assertion reproduction. Change only the
aggregate test: assert exact successful mixed-case stdout, empty stderr and
status 0 for `-i`, and retain rejection coverage with unsupported `-w`.
The corrected file passes 24 cases, and related suites pass 131 cases without
skips. Evidence is `/tmp/safe-bash-default-executor-refactor-*-20260909.log`.
The current normal build and complete packed CLI/SDK smoke also pass; product
code and the command inventory are unchanged by this correction.
Final root lint passes all 10,508 configured inputs, root types and workflows
without errors or warnings (`grep-ignore-case-lint-v1`).
