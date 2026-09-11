# Issue 649: complete portable agent preset

## Validated failures

- Before implementation, fresh `tests/plugins/portable-agent.test.ts` assertions
  found no public portable agent plugin or inventory. Its portable composition
  graph could not resolve the missing module.
- Removing the filesystem alias from the graph test independently reproduced an
  eager `node:fs` import through the filesystem root's transitive graph.
- Root independently reproduced the reported `getSystemErrorMap` startup error
  against the published package in real workerd. Root owns that platform fix,
  export manifests, published-consumer verification and Git delivery.

## Implementation

1. Share standard and complete agent composition; inject the regex executor rather
   than duplicating the command registration list or importing native workers.
2. Preserve the Node aggregate's options and exact 79-command inventory. Expose
   `portableAgentCommands`, `portableAgentCommandNames` and
   `PortableAgentCommandsOptions` through the separate `/portable` entry.
3. Require a host `BoundedRegexProvider`; route grep, rg, egrep, fgrep and expr
   through it. Retain cooperative sed/awk implementations. Never silently fall
   back to native workers or host execution for unsupported provider modes.
4. Keep `/browser` buildable with its existing maintained browser platform wiring.
   The complete preset targets runtimes with supported pure Node builtins, such
   as workerd with `nodejs_compat`; it is not a zero-Node-builtins browser bundle.
5. Import portable filesystem contracts and adapters from `safe-fs/core` directly,
   not an alias that hides unsafe root imports. Root owns the shell runtime import.
6. Verify atomic installation, immutable inventory, old aggregate compatibility,
   provider routing/retirement, explicit unsupported errors and VFS/binary workflows.

## Local evidence and delivery boundary

Node 22 selected from `/tmp/kamilio-toolchain.path` (append `/bin` to PATH).
Maintained focused reporter route:

```sh
node scripts/test-reporting.mjs --import tsx --test-concurrency=1 \
  tests/plugins/portable-agent.test.ts tests/plugins/agent-commands.test.ts
```

Initial focused checkpoint: 43 tests passed, zero failures. This is local evidence,
not a public-package, workerd, remote-main or release claim. Root owns broader
type/build gates, public export verification, atomic commits and release monitoring.

Compatibility refinement: two fresh worker-free tests against the Node definitions
and plugin factories reproduced only two regex pools instead of the original four.
An explicit internal executor map restores independent grep, alias-family, expr
and search ownership while preserving portable sharing. The regression observes
executor identities before worker acquisition and checks family-specific limits.
Both regressions now pass; the complete preset test file passes all nine tests.
The seven focused preset, aggregate, alias, expr and existing portable-regex files
pass with normal per-file isolation. A diagnostic run combining those files with
isolation disabled exposed cross-file prototype-mock interference; keep the
maintained isolation rather than combining lifecycle instrumentation in one process.

Final worker checkpoint: expanded the preset controls to 33 independently executed
source/expected-output rows covering every composed family, including actual patch
application, metadata, archive, stream formatting/inspection, split, tree, file,
column, HTML conversion, du, which, timeout and apply_patch. The complete owned
preset file passes 42 tests. All seven focused preset/aggregate/alias/expr/portable
test files pass using the maintained reporter with normal per-file isolation.
The exact public-runtime matrix is in the contract document, including standalone
and bundled entry names, binary controls and explicit unsupported-mode controls.
Publication remains pending actual release; root owns packed workerd validation.

Contract: `packages/safe-bash/docs/PORTABLE_AGENT_PRESET.md`.

## Root integration evidence

The published 0.1.423 root import reproduced the reported startup exception in
Miniflare 4.20260708.1 with compatibility date 2026-07-01 and `nodejs_compat`.
The host's older libc could not start workerd, so the actual runtime witness used
an isolated Node 22 Bookworm container with networking disabled. That environmental
failure was retained separately and was not treated as a SafeBash defect.

The SafeFS Node platform now falls back to its existing OS errno map when the
runtime exposes an unimplemented `getSystemErrorMap` shim. A fresh throwing-shim
test failed before this change; native errno and alias assertions pass afterward.
The portable entry itself avoids the Node filesystem and native-worker graph.

Direct `/core` imports exposed two integration assumptions. The guarded compiler
now admits the exact canonical core declaration/runtime pair, with in-memory
positive and invalid-target controls. The browser bundler no longer prefix-aliases
an already explicit `/core` import into `/core/core`. The existing browser suite
failed with that doubled path before the fix and passes all six controls afterward.
The maintained Bash runner passes all 282 controls; scoped package-generation and
throwing-shim checks pass three controls. Public tarball and real-workerd candidate
validation remain required before delivery.

The first packed workerd candidate caught an additional integration defect:
`env` received arguments branded by the bundled browser shell while the portable
plugin read a separate unbundled contract registry. The exact failure was
`Expected owned command arguments`. A new maintained tarball smoke reproduces
it under Node as well. The complete `/portable` entry is now bundled as one
contract graph, using the existing browser ERE transport substitution and an
explicit allowlist of compatible Node builtins. The lightweight `/browser`
entry retains its previous no-Node-builtins profile. A bundle-level regression
failed before this wiring and passes afterward, including `env` and `xargs`.

The first full unit attempt also exposed three stale bundle-policy assertions
requiring the removed prefix alias. They now assert explicit core externalization
and both exact source entry points rather than weakening import checks. All 17
focused bundle/package tests pass. The superseded full run was stopped with its
failures retained; it is not counted as a passing final gate.

The corrected normal `npm run build` passed. Fresh standalone 0.0.0-issue649.1
tarballs passed the maintained Node and Bun consumer smoke, public TypeScript
consumer, and zero-Node-polyfill browser bundle/runtime checks. The new owned-
argument regression passes against the installed tarballs.

Real workerd accepted all 33 family rows in the contract, the immutable 79-name
inventory, binary compression/encoding round trip, and both explicit unsupported
regex controls. The public portable bundle has no `node:fs`, `node:fs/promises`
or `node:worker_threads` external. The separate root entry also starts and runs
the report's jq example; that does not make the root graph portable or remove its
explicit Node facilities. These runs used Miniflare 4.20260708.1, compatibility
date 2026-07-01, `nodejs_compat`, Node 22.23.2 in the network-disabled container,
and only installed public package imports. This is not a Bun-hosted Miniflare or
macOS lifecycle claim for issue 662.

An independently exit-checked installed-package smoke verified portable env/jq,
AWK and sed limit diagnostics, and selected private/public address decisions.
Its screenshot `/tmp/kamilio-649-650-652-656.png` was captured and visually
inspected. Final full-unit and lint results are recorded at the delivery gate.

The final combined lint passed. The full unit route passed 40,040 shared and
282 runner controls, but Bash retained 18 failures: the POSIX separator contract,
the committed-archive authority check against uncommitted compiler changes, and
16 public cleanup fixtures whose staged peer binding does not include `/core`.
These are unresolved integration gates, not successful validation. Issue 649 is
isolated from independently validated issues 650, 652, 656, 659 and 660 so those
fixes can ship without waiting for this public-consumer integration work.

Those independent fixes are now delivered on main. A fresh contract regression
confirmed that replacing the full POSIX path object with the reduced core helper
object removed `sep` and other existing methods. Node and complete portable
consumers now retain `node:path`'s full POSIX object without importing filesystem
capabilities. The lightweight browser build explicitly retains its existing core
path shim. The strengthened path contract and portable preset pass 102 tests;
both bundle profiles pass 15 focused controls, with no filesystem/native-worker
external admitted. This preserves the old Node API rather than merely adding a
separator to the reduced helper object.

The staged public-cleanup consumer now derives peer imports from its captured
source inputs, authenticates the exact current root/core declaration and runtime
closure, and checks both public routes in emitted artifacts. Registry-release
profiles retain their historical root-only contract. The new closure/substitution
controls passed 64 canonical-peer tests and seven checkout compatibility tests;
the actual staged consumer still requires the rebuilt canonical candidate.

After the corrected normal build, all 201 focused controls passed, including the
previously failing public-cleanup fixture and its negative/tamper cases, the full
POSIX contract, portable preset, canonical peer closure and predicate controls.
Repository lint also passed with all writers frozen. A local candidate commit is
required next so the committed-archive gate tests the actual compiler authority;
the broader unit route and refreshed packed runtime checks remain delivery gates.

The committed-candidate route passed 40,040 shared controls (42 skipped), 29 Python
controls and 282 runner controls. Bash completed 22,003 controls: 21,939 passed,
63 skipped and one failed. The sole failure was the S3 committed consumer's
root-only peer binding, not a product execution assertion. The outer tool session
reported signal 143; the retained child log contains the final Bash failure
summary. No successful full-route or posttest result is claimed for that attempt.

The S3 verifier now derives explicit public imports from authenticated committed
source bytes, never live source payloads, then carries the authenticated public
routes into its packed runtime closure. Default and historical peer bindings are
unchanged. Six new memory/closure controls and the exact committed packed-consumer
case passed together (seven focused controls). The remaining correction changes
only verification helpers and their tests.

An overlapping packaging attempt consumed the intermediate unbundled workspace
output rebuilt by the unit route, and its consumer lacked a local package
manifest. Its browser failure is retained, not counted as final qualification.
Final packaging must follow the complete normal build and use an explicit isolated
consumer manifest before installation; do not package concurrently with builds.

## Delivery validation after upstream rebase

Rebased onto upstream c029ad482 without altering its SafeJS changes. The normal
build and guarded repository lint passed. Fresh isolated 0.0.0-issue649.4 tarballs
passed maintained Node, Bun, TypeScript and browser consumer checks. SafeBash and
SafeFS dist trees are byte-identical to the 0.0.0-issue649.3 artifacts that passed
all 33 real-workerd families, immutable 79-command inventory, binary round trip,
unsupported modes, full POSIX helpers and root-startup jq control. The portable
graph excludes filesystem and native-worker imports; the root graph does not.

The rebased full route passed 40,151 shared tests with 42 skipped, but failed one
unchanged harness recovery test: two in-flight promises cannot snapshot an active
promise reaction. A focused rerun reproduces it. Upstream-only CI run 34188819065
also fails that exact test without these portable commits. No unrelated snapshot
patch or passing full-suite claim is made. A subsequent whole-Bash tool session
was interrupted with signal 143 after 400 files; it is not a passing suite.

Final affected verification passed 364/364 tests, including the committed S3
archive, public cleanup consumer, peer tamper controls, path contracts and portable
preset. The maintained posttest lint-stress route passed both tests. These focused
passes supplement the earlier full Bash result, whose sole consumer failure is
now fixed; they are not relabeled as an uninterrupted successful full-root run.
