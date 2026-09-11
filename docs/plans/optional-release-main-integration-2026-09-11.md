# Optional Safe Bash integration qualification

The candidate is validated locally on main in the original checkout,
`/Users/kjopek/Workspace/poe-setup-scripts`. The initial integration was prepared
in `/private/tmp/poe-optional-integration-aHlAip`. The normal full build, maintained
full npm test including posttest, repository lint, package lint, strict Bash
consumer checks, and installed four-package consumers passed. This candidate
has **not been pushed or published**. Initial npm creation and trusted-publisher
configuration for `@poe-platform/safe-bash-optional` remain external prerequisites;
root's latest registry check returned 404.

## History and delivery boundary

- `efa6c2efa` merges original `57f68f67e` with remote `4af337d98`, preserving
  both histories from common ancestor `25b940bd7`.
- `f0df68ad9` incorporates delivered SafeJS `edb7ce8c2`.
- `a2bcb6210` incorporates original repair ancestry `ceacf3910` without
  changing the already reconciled tree.
- `9b6446da1` completes device-view, descriptor-retirement, and fixture
  reconciliation. This is the source revision qualified by the full gates below.
- The subsequent merge includes remote `7ede49079`, a single SafeJS replay-test
  optimization preserving 128 draws, 128 host calls, input mutations, and three
  replay generations. Its ten affected tests and exact-file ESLint pass.
  Product source and review artifacts are unchanged by this follow-up.

Root fast-forwarded the original checkout to qualified `89fc9b589`, then assigned
integration of remote `79999cba7` there. That remote merge preserves both
`936a41f77` (snapshot scalar preflight) and concurrent `31fe11c1f` (implicit mkdir
parents). Original `ceacf3910`, `89fc9b589`, and delivered `79999cba7` remain
ancestors of the final local merge. The delivery clone was read-only. Independent
SafeJS publication does not publish this optional stack. No local npm publication
was attempted.

## Final behavior

Current-main defaults and public conditional exports remain. Core cmp, shuf,
truncate, and restricted yq coexist with separate optional implementations; equal
names do not imply equivalent semantics. Duplicate registration rejects unless
callers explicitly select `replace: true`. Optional
`mapfileExtension({ replace: true })` similarly replaces core mapfile/readarray;
omission retains duplicate-builtin rejection. Optional yes, dd, and install stay
separate factories. Independently declared exact inventories, factory exclusion,
and same/foreign runtime identity checks remain active.

Packaging resolves nested declaration conditions and retains browser/workerd
entries. Only eight optional Mike-yq families are excluded from core:
arguments, evaluate, expression, inplace, mike, native-encoder, native-work, and
nodes. Shared restricted YAML/TOML remains in core. Optional YAML is the declared
optional peer yaml@2.9.0. No obsolete browser alias or duplicate runtime was added.

Canonical descriptors and retained handles coexist with current-main memory
ledgers, budget admission, cancellation, and cleanup. Canonical descriptors gain
no invented seek operation. Core cmp uses bounded sequential reads for shared
regular input with unequal skips while retaining opaque-stream behavior. Raw
byte-value and IFS identity remain through parser, expansion, and runtime paths.

Public inline Shell input keeps current-main iterator admission;
`stdinInput.read` activates bounded cumulative accounting. The strict internal
prepared-bytes helper remains bounded before copying. Fixtures exercising legacy
streaming explicitly decline canonical open instead of selecting another route.
Public generic diagnostics retain exact internal reasons via onInternalError.

`ShellOptions.deviceView` selects default or provided. Default synthetic
/dev/null continues shadowing backing entries. Provided omits only that overlay;
canonical normalization, validation, budgets, cancellation, and retained cleanup
remain. The policy applies to exec filesystem overrides and nested execution.
API/contract documentation and the optional README describe it. Eleven frozen
native null scripts remain unchanged alongside default shadowing controls.

Completed descriptor cleanup registrations retire after successful cleanup,
preventing accumulation in long executions. Synthetic null streams advertise
truthful independent lifetimes. Install selects output using destination
capabilities; install and yq capture bounded retained cleanup before mutation so
cancellation can retire owned targets/staging files. Exact byte, mode, inode,
admission, falsey-error, and cancellation assertions remain.

## Qualification

The uncached maintained unit route reported 72 workspaces and 41 declared test
tasks, with no excluded tasks. Missing test declarations were explicitly
classified as not passes. All full-unit phases below are in
`/tmp/poe-optional-integration-full-test-4.log`; the root command exited zero.

| Phase | Result |
| --- | --- |
| Shared unit workspaces | 939 files / 23,336 tests passed; 2 files/tests skipped |
| Python workspace | 29 tests passed |
| Bash maintained runner | 493 passed |
| Bash full suite | 38,017 passed, 414 skipped, zero failed/cancelled; 1,072 discovered files |
| SafeJS full suite | 1,301 files / 28,916 tests passed; 2 files / 47 tests skipped |
| Remaining workspace suite | 8 files / 288 tests passed |
| Native npm posttest lint stress | 2 passed |

Additional successful gates:

| Check | Evidence |
| --- | --- |
| Normal full build, public wrappers and root suffix | `/tmp/poe-optional-integration-full-build-4.log` |
| Repository lint: guarded ESLint, root/consumer types, workflows | `/tmp/poe-optional-integration-root-lint-stable.log` |
| All 17 package lint rules | `/tmp/poe-optional-integration-package-lint-stable.log` |
| Bash source/tests and 26 consumer groups; expected negative rejections | `/tmp/poe-optional-integration-typecheck-stable.log` |
| Follow-up SafeJS replay: 10 passed, 128-draw case in 802 ms | `/tmp/poe-optional-completed-replay-final.log` |
| Follow-up exact-file ESLint | `/tmp/poe-optional-completed-replay-eslint.log` |

GNU Bash 5.2.37 native checks authenticated the selected executable against
caller-supplied SHA256
`9285bd1f401901808d125f7585a74812963cee323fdab1b2199162dc2ab29203`.
Historical captures remain unchanged; an earlier machine's binary digest is not
required of a newly authenticated build. Source-authenticated tests ran with
the tree frozen at 9b6446da1 and matched before/after hashes. Counts above are
separate phases, not overlapping focused totals or claims that skipped cases pass.

## Final original-checkout follow-up

The two subsequent source changes were reconciled without dropping optional
behavior. Snapshot validation preflights only safely inspectable plain/null
own-data clock/random fields, retaining the original post-traversal validation
and fallback behavior for accessors, proxies, and inherited shapes. Independent
review rejected earlier mutation/inheritance acceptance regressions; the final
implementation and regression controls preserve the prior acceptance policy.
The 96-case adversarial corpus and 750 ms cap are unchanged.

Existing-directory `mkdir -p` now delegates when the selected path capability
advertises implicitDirectories, materializing adapter metadata without forwarding
a new mode or emitting a creation message. Current preflight, falsey cancellation,
and ordinary-directory behavior remain. This command change does not establish
that every adapter, including the bundled S3 implementation, persists implicit
directories; see `728-mkdir-implicit-directories.md` for its exact scope.

Focused follow-up qualification passed on the original checkout:

| Check | Result and evidence |
| --- | --- |
| Normal full build and root suffix | Passed; `/tmp/poe-original-final-integration-build.log` |
| Filesystem/mkdir/capability/output selection | 241 passed, zero skipped; `/tmp/poe-original-mkdir-focused-final.log` |
| Snapshot/restore/adversarial selection | 229 passed across 18 files; mutation corpus 500 ms; `/tmp/poe-original-snapshot-focused-final.log` |
| Maintained Bash source/tests/consumer types | 26 consumer groups passed; `/tmp/poe-original-final-integration-bash-types.log` |
| Stable guarded ESLint | 11,801 configured files linted, zero warnings/errors; `/tmp/poe-original-final-integration-eslint-stable.log` |
| Refreshed complete installed workflow | Passed; `/tmp/poe-original-optional-installed.log` and `/tmp/poe-original-core-installed.log` |

The earlier full unit and repository lint gates bind product revision 9b6446da1;
these isolated subsequent changes received the focused checks above, not another
full unit run. An initial follow-up lint attempt overlapped the full build and
correctly rejected toolcraft directory identity changes. After all build/consumer
work ended, the stable guarded rerun completed successfully without weakening
admission. That rejected attempt remains `/tmp/poe-original-final-integration-eslint.log`.

## Installed review artifacts

Four provisional review packages were generated from the successful full build
before unit compilation could replace portable output. Version
`0.0.0-integration.20260911` is local review metadata, not a registry release.
The current artifacts include the final snapshot and mkdir source changes.
Directory: `/private/tmp/poe-original-release-qualified-qzLR0d`.

| Tarball in tarballs/ | SHA256 |
| --- | --- |
| poe-platform-safe-fs-0.0.0-integration.20260911.tgz | `350ddf04db0e7929fd2994c1a19866a8050b002ebd6fefb2f6bd672cb7bd02c0` |
| poe-platform-safe-js-0.0.0-integration.20260911.tgz | `d1e43a909e5d625928d5462c359819197d4004164e001c6cde57fd3f373d91ab` |
| poe-platform-safe-bash-0.0.0-integration.20260911.tgz | `d110360373811da5eac882ffe41faf2ddc0490b5f89943157dc9d59e0bae8f7e` |
| poe-platform-safe-bash-optional-0.0.0-integration.20260911.tgz | `159ccdfefef596b078544494f5377a44f3b7260950f8a1e26d9f8475c379fde5` |

Complete installed workflow passed: optional Node/Bun without YAML using the
workflow's --omit=optional install, strict exact-optional TypeScript, then YAML
2.9.0 runtime covering all commands/extensions and same/foreign runtime identity,
followed by strict types. Core Node/Bun smoke, declarations, browser bundle and
execution, legacy poe-code@14.0.4 adaptation, and standalone SafeFS Node/Bun passed.
The core and browser fixtures include the new implicit-mkdir regression.
Logs: `/tmp/poe-original-optional-installed.log` and
`/tmp/poe-original-core-installed.log`. SHA256SUMS accompanies the tarballs.
The earlier four review artifacts remain in
`/private/tmp/poe-optional-release-stable-79PtcW`; SafeFS and optional tarball bytes
are unchanged, while core and SafeJS were refreshed for the two source changes.
Publication must regenerate the release-selected version through GitHub after
bootstrap configuration.

## Remaining delivery prerequisite

Local integration and qualification are complete. Root coordinates any
remote-main delivery and release. The original checkout is reconciled. Optional npm
creation and trusted-publisher configuration are still required: npm trust
requires an existing package. Omitting the optional artifact does not satisfy
the four-package release. Report local commits, verified remote delivery, and
successful registry releases separately.

## Investigation record

Earlier full runs were discovery. The third reported 37,781 Bash passes,
187 failures, and 42 cancellations. Exact failures were corrected or traced to
source-authentication rejection during concurrent edits; the frozen fourth run
covered them successfully. Original logs remain at
`/tmp/poe-optional-integration-full-test{,-2,-3}.log`.

Generic metadata autodetection for supplied null devices was rejected: a
replacement test demonstrated truncation could follow a character-device probe
before descriptor validation. Explicit deviceView avoids that unsupported
guarantee. Evidence: `/tmp/poe-null-composition-race-red.log`. Historical native
captures, inverse fixture revisions, exact archive drift controls, and
source-authentication guards remain.
