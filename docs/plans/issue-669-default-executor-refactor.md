# Issue 669: default executor factory refactor

## Scope and contract

After root delivery of 00a91821f, implement the September 8, 2026 16:30:31 UTC
author-approved breaking factory refactor. This is prerequisite factory wiring
for the prioritized issue 672 default graph, not its crypto/compression work.

- Add `regexExecutor?: BoundedRegexProvider` directly to factory options. Keep
  the existing provider-shaped interface; no adapter or legacy property alias.
- Switch aggregate, grep, rg and expr factories from the Node client class to
  the existing portable executor and bounded default provider. Grep retains its
  flat policy fields. Standard and standalone alias factories forward injection.
- One aggregate provider feeds one general executor for grep/egrep/fgrep/expr;
  search shares it unless an explicit search regex policy needs a second executor.
  Nested aggregate search/expr options cannot override the top-level provider.
- Preserve independently declared 79-name inventory, collision preflight,
  replacement, execute forwarding, limits and invocation cleanup. Aggregate
  plugin disposal closes its executors idempotently and blocks later setup.
  Never dispose a caller provider or endpoints belonging to another owner.
  Bare command arrays retain invocation-owned cleanup rather than introducing
  a new public disposal API.
- Preserve issue 670 bounded expr matching and explicit unsupported modes. No
  native RegExp fallback, dialect expansion or new provider implementation.
- Root owns public entries/exports, deletion of browser/portable aliases,
  bundling, Node factory naming, consumer migration and test registration.

## Owned paths

- `packages/safe-bash/src/plugins/index.ts`
- `packages/safe-bash/src/plugins/composition.ts`
- `packages/safe-bash/src/commands/grep.ts`
- `packages/safe-bash/src/commands/search/rg.ts`
- `packages/safe-bash/src/commands/search/options.ts`
- `packages/safe-bash/src/commands/expr/index.ts`
- `packages/safe-bash/src/commands/expr/internal.ts`
- `packages/safe-bash/src/commands/grep-aliases/index.ts`
- `packages/safe-bash/src/commands/standard.ts`
- `packages/safe-bash/src/commands/index.ts`
- `packages/safe-bash/tests/plugins/default-executor-refactor.test.ts`
- This plan.

## Validation

Use Node 22 selected by `/tmp/kamilio-toolchain.path` and the maintained
`packages/safe-bash/scripts/test-reporting.mjs`. Normal isolated tests are
authoritative; per-file no-isolation runs are diagnostics only. No combined
no-isolation runs, disk fixtures, builds, full lint, README, manifest or Git edits.

1. RED: default graph, aggregate inventory/semantics, all standalone injection
   routes, independent limits, shared pools and borrowed-provider lifecycle.
2. Implement only factory selection, option forwarding and aggregate cleanup.
3. GREEN: focused tests and narrow existing provider regressions; root handles
   broad consumer changes and integrated build/type validation.

## Results: September 8, 2026

- Node `v22.22.0` from the designated toolchain. Product files were unchanged
  before the first focused RED run through the maintained isolated reporter:
  one failed file summary. A separate per-file diagnostic run reported
  **24 cases, 23 failures, one pass**. Failures exposed the eager Node client,
  ignored injections, unsupported default-mode differences, separate pools and
  missing aggregate disposal. One assertion inspected the plugin inventory
  before the shell's deferred setup; moved it after execution. Invalid-provider
  tests also explicitly invoke lazy standalone plugin setup.
- After factory wiring, the authoritative isolated focused file passed.
  The separate per-file diagnostic run passed **24/24**, no skipped, cancelled
  or TODO cases. Fifteen public routes cover aggregate definitions/plugin,
  grep, standard definitions/plugin, rg, search definitions/plugin, expr
  definition/list/plugin, egrep, fgrep and alias definitions/plugin.
- Adjacent authoritative isolated checks passed all four file summaries:
  `tests/commands/regex-execution/provider.test.ts`,
  `tests/commands/regex-execution/default-provider.test.ts`,
  `tests/commands/regex-execution/bounded-expr-provider.test.ts`, and
  `tests/commands/regex-execution/node-provider.test.ts`.
- Graph qualification is narrowly that the common factories no longer import
  `commands/regex-execution/client.ts`; it is not a claim that root exports,
  bundling, crypto/compression or the complete issue 672 graph are finished.
- At the initial factory-only handoff, root was notified to register the new
  test and migrate legacy consumers. Root subsequently delegated the source-test
  migration documented below. No manifest, README, public entry, provider engine,
  crypto/compression implementation or Git state was edited by this worker.

Commands from the repository root:

```sh
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
PATH="$TOOLCHAIN/bin:$PATH" node packages/safe-bash/scripts/test-reporting.mjs \
  --import tsx --test-concurrency=1 \
  packages/safe-bash/tests/plugins/default-executor-refactor.test.ts
PATH="$TOOLCHAIN/bin:$PATH" node packages/safe-bash/scripts/test-reporting.mjs \
  --import tsx --experimental-test-isolation=none \
  packages/safe-bash/tests/plugins/default-executor-refactor.test.ts
PATH="$TOOLCHAIN/bin:$PATH" node packages/safe-bash/scripts/test-reporting.mjs \
  --import tsx --test-concurrency=1 \
  packages/safe-bash/tests/commands/regex-execution/provider.test.ts \
  packages/safe-bash/tests/commands/regex-execution/default-provider.test.ts \
  packages/safe-bash/tests/commands/regex-execution/bounded-expr-provider.test.ts \
  packages/safe-bash/tests/commands/regex-execution/node-provider.test.ts
```

## Authorized source-test consumer migration

Root subsequently expanded ownership to active source tests, excluding other
workers' checksum/random/timer/compression/archive tests. Later explicit approval
allowed the two tail-follow files' import-only migration. Active test discovery
was used to select consumers; no historical immutable snapshots were changed.

- Removed source-test dependencies on the deleted browser/portable entries and
  preset aliases. Public-source tests now import `src/index.js`; browser VM
  tests consume `core.browser.js` from the maintained in-memory browser build.
- Preserved the independently specified 79-name inventory. The assertion for
  the removed exported immutable name array now checks exact default definitions;
  it does not recreate a compatibility export. The old 28-command capability
  assertions still cover exactly those independently named commands, without
  inventing new metadata requirements for unrelated aggregate commands.
- Preserved original native regex tuples, limits and lifecycle expectations via
  explicit `createNodeRegexProvider` imports from `src/node.js`. Existing standard,
  search and expr compatibility helpers use that explicit native profile. The
  new default-factory suite and bounded-provider suites retain bounded defaults.
- Lifecycle spies now observe the common portable executor prototype rather
  than the old Node subclass; tests constructing Node executors explicitly keep
  that implementation. General pool assertions reflect actual shared ownership
  while retaining separate search-policy and retirement checks.
- VM fixtures provide standard browser `performance`; Buffer/process absence
  and reachable-output no-Node-builtin assertions remain enforced. Native Bash
  oracle execution initially hit sandbox EPERM; the authorized rerun passed
  all 91 printf-variable cases without changing assertions.

Exact additional changed paths, relative to `packages/safe-bash/tests/`:

- `commands/capability-requirements.test.ts`
- `commands/cut-portable.test.ts`
- `commands/directory-admission.test.ts`
- `commands/filesystem-output.test.ts`
- `commands/helpers.ts`
- `commands/network/fetch-transport.test.ts`
- `commands/network/mounted-output.test.ts`
- `commands/regex-execution/bounded-expr-provider.test.ts`
- `commands/regex-execution/portable.test.ts`
- `commands/regex-execution/commands.test.ts`
- `commands/regex-execution/cleanup-registration/controls.test.ts`
- `commands/regex-execution/continuation/glob-transport.test.ts`
- `commands/regex-execution/worker-range-admission.test.ts`
- `commands/search/capability-requirements.test.ts`
- `commands/search/helpers.ts`
- `commands/search/pipelines.test.ts`
- `commands/search-stress/direct-stdin-close.test.ts`
- `commands/search-stress/stdin-shell.test.ts`
- `commands/tail-follow.test.ts`
- `commands/tee-target-admission.test.ts`
- `commands/text-programs/sed-program-budget.test.ts`
- `commands/xargs-parallel.test.ts`
- `commands/expr/helpers.ts`
- `commands/expr/named-profile.test.ts`
- `commands/expr/regex-lifecycle.test.ts`
- `commands/expr/output-quota.cases.ts`
- `commands/expr/regex-limits.cases.ts`
- `commands/grep-aliases/aliases.test.ts`
- `commands/grep-aliases/native.test.ts`
- `commands/grep-aliases/safety.test.ts`
- `plugins/agent-commands.test.ts`
- `plugins/portable-agent.test.ts`
- `plugins/portable-default-agent.test.ts`
- `shell/printf-variable.test.ts`
- `shell/stdin-origin.test.ts`
- `shell/tail-follow-lifecycle.test.ts`
- `shell/xargs-parallel-lifecycle.test.ts`

Active discovery after migration found no remaining references to removed
browser/portable source entries or command factories. This is an active-test
consumer check, not a claim about historical fixtures or the entire repository.

Final authoritative validation used Node 22, the maintained reporter,
`--import tsx --test-concurrency=1`, and normal process isolation. The selected
35-file cohort comprised every changed `.test.ts` listed above, the new
`plugins/default-executor-refactor.test.ts`, and the unchanged
`commands/expr/expression.test.ts` and `commands/search/rg.test.ts` to exercise
their migrated case/helper dependencies. **1,634/1,634 passed**, zero failed,
cancelled, skipped or TODO, in 24.737 seconds. Existing native oracle checks ran
with explicit authorization outside the process-restricted sandbox.

All assigned factory and active consumer migration work is ready for root's
source freeze. Integrated typechecking, root export/bundler and installed default
zero-Node qualification remain root-owned; no worker build, full lint or Git
operation was performed.
