# DOCX portable dependency build isolation

Task65 setup correction; task66 remains pending. This procedure does not define
format behavior: docs/specs/docx.md remains the sole Proposed format contract.
Root owns this plan and Git integration. Domain owns safe-fs native-assets.mjs,
its native-assets.test.ts and package.json portable script. Build leaf owns
scripts/build-workspaces.mjs, its dependency-events.test.ts and the docx manifest
mapping. A different leaf independently reviews both candidates. No README,
historical seal, dependency lock or release changes. No compiler execution is added to portable builds;
default native builds remain unchanged.

## Validated problem and first atomic improvement

The original injected memfs supported-Linux probe demonstrates that DOCX's normal
safe-fs dependency event attempts compiler discovery and compilation; missing
compiler raises ENOENT. Browser runtime isolation and macOS targets[] do not
qualify a portable build. Evidence: /tmp/docx-task65-native-build-investigation.log.

Explicit safe-fs --portable mode skips host report/target resolution, headers and
compiler discovery. It emits authenticated loader/declaration/source metadata
with targets[], preserving registered artifact cleanup. Default native behavior
is unchanged. Four original failures precede implementation; 29 tests then pass:
/tmp/docx-task65-portable-assets-original-red.log and
/tmp/docx-task65-portable-assets-green.log. Maintained safe-fs typecheck passes.
Independent 29-case verification and frozen-input hashes are recorded in
/tmp/docx65-independent-portable-assets-1904.log and companion inputs JSON.

The first commit adds this available event only. DOCX selection through the generic
runner is a separate improvement and remains uncommitted until its own delivery.

## Generic event selection and qualification procedure

Admit only matching local dependency edges and declared literal build/build:*
events, including valid npm lifecycle scripts. Targets retain normal build.
Normal-root authority dominates custom requests; equal requests deduplicate and
custom conflicts fail before spawn. Preserve graph closure, topological ordering,
uncached execution, unit task membership and caller profile/hook environment rules.

Ten original memfs failures precede implementation; 210 existing/new/parallel
runner cases pass after script-ready freeze. Independent 210-case review approves
normal full/direct/unit selection and selected DOCX portable selection. Mocked
selection census is not actual build evidence. Logs:
/tmp/docx-task65-dependency-events-original-red.log,
/tmp/docx-task65-dependency-events-script-ready-green.log,
/tmp/docx65-independent-dependency-events-1907.log,
/tmp/docx65-independent-actual-dependency-events-1907.log.

Root executes maintained selected DOCX build, then full npm test and repository
lint because this correction changes shared infrastructure. Selected build passes
at /tmp/docx65-portable-selected-build-final.log: five derived stages, safe-fs
build:portable and explicit targets[]. Portable code plus injected Linux tests
establish compiler avoidance; an unsupported-host default skip does not.
Repository npm run lint passes ESLint, maintained type routes and workflow lint
at /tmp/docx65-full-maintained-lint.log. Full npm test remains running; its shared
workspace phase and 515-case safe-bash runner gate have completed without failure.
Safe-bash runtime counters: 38,964 tests, 38,141 pass, zero fail/cancel/todo and
823 skips. Skips are not passes or optional-profile qualification. Remaining
declared unit tasks (including safe-js) still run; this is not full-test success.

Commit explicit owned files only on main, with hooks enabled; preserve unrelated
index/worktree changes. No push or release. Advance task65 only after final checks,
evidence reduction and verified atomic commits; do not start task66 early.

## Final broader result

Maintained uncached npm test exits0 at /tmp/docx65-full-maintained-test.log,
including declared root/workspace tasks, native npm pre/event/post and root
posttest lint-stress (2 passing tests). Safe-js passes1,301 files/28,932 tests
with2 skipped files/47 skipped tests; terminal-pilot passes8 files/288 tests.
No-declared-test workspaces and skipped cases are not passes. Repository lint
exits0. Selected portable build and independent original reds/greens qualify
this bounded correction; no corpus/model/full-shell parity claim is added.

## Atomic local delivery

Safe-fs portable mode is locally committed as5d79b7bd3; that commit adds only
the available event and this plan. This next atomic change activates generic
declared dependency-event selection and the DOCX manifest mapping. All candidate
source was frozen throughout final maintained tests/lint/selected build.
No remote delivery or release has occurred or is authorized.
