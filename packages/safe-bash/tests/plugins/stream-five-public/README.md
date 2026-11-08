# Five-command public/default author integration

This author scope integrates the already implemented `seq`, `nl`, `rev`,
`unexpand`, and `split`. It owns no product algorithms, native oracles,
filesystem implementation, regex code, root TypeScript configuration or
independent reviewer cases. The package remains `virtual-bash`, with zero
runtime dependencies. It is not independent acceptance or a full-project gate.

The qualified stream/native profile and scoped 65-command consumer success do
not establish overall package lifecycle acceptance or release readiness. Per
the user's August 27, 2026 update, **five public premature-cleanup failures
remain OPEN**, routed to Sagan/Arch pending independent closure. Optional
`InvocationCleanup` contract `07acb1a4` alone does not establish that closure;
runtime/regex integration remains in progress in that update. This documentation
qualification does not rerun or independently verify those failures.

## Public surface and original observations

- `333c7bb`: root exports from the actual stream-format and split modules.
  The initial multi-file patch stopped at a context mismatch after the root
  export applied, so aggregate/subpath wiring is the separate `b7e9eb5` commit.
  The existing `RegexExecutionOptions` export is preserved.
- Root and `virtual-bash/commands/stream-format`: `createStreamFormatCommands`,
  `streamFormatCommands`, `StreamFormatCommandsOptions`, `StreamFormatLimits`.
- Root and `virtual-bash/commands/split`: `createSplitCommands`, `splitCommands`,
  `SplitCommandsOptions`, `SplitLimits`.
- `AgentCommandsOptions.streamFormat` and `.split` omit the family `replace`
  flag. One aggregate replacement policy and all-name collision preflight
  remain. `streamInspection` stays separate. Actual default definitions and
  dispatch are 65 unique names; curl and SafeJS remain explicitly optional.
- `evidence/baseline60.json`: original exact registry assertions at `bf8b554`,
  **31/31**. `evidence/unchanged-postwire.json`: same test SHA256 after `b7e9eb5`,
  **29/31**, with two exact stale registry failures. `5560a52` is test-only:
  five added expected names, counts 60/61 to 65/66, and a nonnumeric family
  title. The other original assertions remain. Current registry **31/31**.

The separate scoped module READMEs describe command dialects and limits; their
old source-only availability text is historical, not current public wiring.
No new flags or complete GNU compatibility are promised by these exports.

## Portable public verification

Use already installed Node >=22, TypeScript and tsx; no installation is done:

```sh
LC_ALL=C LANG=C TZ=UTC npm run verify:stream-public -- --source-commit HEAD
```

The helper resolves HEAD to a full immutable commit before archiving selected
tracked paths. `--source-commit COMMIT` is also accepted. There is no mutable
source fallback; executing helper/fixture hashes must match the chosen commit.
The shared installed development tooling is hashed, not packaged. Source and
package/configuration hashes, archive hash, actual command output, timestamps,
index names and Node/compiler/type package identities are recorded. Snapshots
and failures remain under the ignored, author-owned `.runs/` directory.

The snapshot runs the unchanged product build configuration in its own root,
never emitting repository-root dist. It runs the exact current registry test,
packs twice using normal `npm pack --offline --json`, compares archive bytes,
moves an extracted offline consumer with only the package, and validates:

- all four factory/plugin values through root and both new package subpaths;
  all four public types and every limit field under strict NodeNext with
  `skipLibCheck:false`; seven independent wrong-option/type rejections;
- actual compiled default dispatch of all five and the old four, binary VFS
  splitting and live pipelines, delayed/retaining sink ownership/backpressure,
  cancellation, new-name collisions/replacement and separate family limits;
- no source tree or runtime dependencies in the moved package; read permissions
  restricted to the consumer, with an explicit denied source-read control.
  The permission model is a harness check, not a product security guarantee.
  No host network request is needed; npm is offline. This is not a claim of
  operating-system network isolation.

The initial qualified artifact at `dbe3cfd` ran **21/21** packed Node test groups,
positive strict types and seven expected negative diagnostics. npm **10.9.7**
produced two identical 637-entry archives, SHA256
`b37370252ae323bd1d63c7856be3cf40ed1b91bda00e3d6da837d6f067af84de`.
An isolated copy with an added prepare sentinel demonstrates that npm10.9.7
executes prepare both normally and with `--ignore-scripts`; the real package
does not acquire this lifecycle hook. Ignore-scripts alone is not the pack
isolation strategy. The final follow-up records built-file SHA256s and checks
that packing leaves emitted bytes unchanged.

## Mandatory qualified release profile

The existing `test`, `test:contracts`, `typecheck`, `build`, and cold portable
`typecheck:consumers` scripts are untouched. They do not replace the following
explicit, separately mandatory qualified job. No CI vendor is assumed.

```sh
LC_ALL=C LANG=C TZ=UTC npm run verify:release:qualified -- \
  --source-commit HEAD \
  --native-assets-from "$PWD/tests/commands/metadata-stress/.oracle/coreutils-9.7"

LC_ALL=C LANG=C TZ=UTC node tests/plugins/stream-five-public/prerequisite-controls.mjs \
  --source-commit HEAD
```

The first command executes, in order with nonzero propagation:

1. Archive committed current source and authenticate metadata/table setup plus
   all frozen stream references before any product execution.
2. Copy only the 14 authenticated primary metadata assets into that owned
   snapshot, preserving modes and checking destination hashes. The distinct
   historical stat stays at its explicitly pinned absolute location. Recheck
   setup inside the snapshot, then run the unchanged canonical mandatory
   native runner, requiring **318/318**, **22/22** routed native rows and no
   skip/TODO/cancellation. The table batches contain 71 and 216 fixture rows;
   these are separate denominators, not 318 native inputs.
3. Emit and run the new current-default profile of the frozen 82 stream inputs,
   three workflows per adapter and 16 contract groups, using actual aggregate
   family options. Require the unchanged stronger diagnostic classifier and
   its existing negative controls. Emit current-source provenance separately
   from the historical `72f780d` release artifact.
4. Run the portable compiled/packed public checks against that same snapshot.

The canonical profile is GNU coreutils9.7 built locally on **Darwin arm64**,
not GNU/Linux. The initial verified host is Node22.22.2, macOS26.4.1 build25E253;
TypeScript5.9.3 and Node types22.20.1. Native child tests receive
`LC_ALL=C LANG=C TZ=UTC PATH=/usr/bin:/bin` from the canonical runner; the release
orchestrator/pack subprocesses additionally put the running Node directory
first in PATH. Ambient Node options/startup/locale variables are not forwarded.
Always use C/UTC even to launch Node/npm.

The 15 exact metadata assets and pins are in the unchanged
`tests/commands/metadata-stress/canonical-env/runner.mjs` and its authenticated
oracle records; all exact paths, hashes and executions are in each report's
`canonicalSetup` and `archivedSetup`. Fourteen primary assets comprise archive,
sources/manual and native binaries; the fifteenth is the distinct stat at
`/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat`,
SHA256 `bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860`.
Stream references also require their frozen absolute paths, exact binary hashes,
macOS profile and C/en_US.UTF-8 locales. This is an explicit existing-host
qualification, not an automatic relocation/build/download recipe.

Missing assets, wrong hashes, unsupported native host, or omitted explicit
asset location return **78**, `setup-unavailable`, zero products/tests—not a
pass or skip. Genuine verification errors return nonzero. A setup-only probe
can use `--check-only true`; its report has zero tests and is not a release pass.
The two negative controls use new copies: one omits chmod, one corrupts the
copied chmod. Neither renames/deletes/mutates host pins. Both originally returned
78 with no compile, metadata or consumer execution. Child processes are bounded;
no watcher, gate wait or stopped worker is used. Failure snapshots are retained.

## Exact current-profile migration

Historical files in `tests/commands/stream-next-stress/` stay byte-exact.
`current-profile.mjs` authenticates original harness SHA256
`6fa5b5e445500e0ab29be962e9c5ac39a7e2e830fc736fd344e0580778c0f3ae`
and applies exactly 12 single-site replacements. The final migrated harness is
SHA256 `90e709ceb02ec58080deeb2e56f589258fce8b7a2d51006470a284cb9ada364a`.
The first successful current run used
`58e299d5c3bdc88c09a27c21f720cd592941d0092bcadd7363635df43aacad6c`;
the follow-up adds exact successful stdout expectations to the registry-only
dispatch migration, not to frozen native inputs. Both profiles are retained.

The replacements only migrate default60 absence to default65 presence/success,
account for actual split output in that obsolete absence fixture, remove two
duplicate plugin installations, and route four limit fixtures through actual
`streamFormat`/`split` aggregate options. Standalone collision/factory tests
remain standalone. All original limit numbers, native input bytes, oracle
outcomes and diagnostic classifiers are unchanged. The generated current
harness and exact before/after strings are recorded as `current-profile.json`.

Frozen corpus SHA256:
`7b3886e8249d599c970e7ad89900b60aa10f067a239a24960ec090d3ac4f3fc6`;
raw native JSON:
`55c1d647f08699a6020d1f8a7afbedf397f534d0a8f0386a7ea0eda0bd1bbe30`;
capture script:
`a4011f37df616d40624f99ba3d3b9eb4ae60a7ae7722a52c55c7d49a20032481`;
unchanged strong classifier:
`a0a573ac0d7f5ccbfd40b26a0efaf967533a2d02a9e9a65dfccaa4289f12e40c`.
The historical release JSON supplies only the already authorized diagnostic
policy to that unchanged classifier; it is not used to choose current source
or represented as a current release. Current source/harness pins come from the
new snapshot/result report.

Current observed results match the historical denominators: **82 distinct
inputs**, 164 primary executions on MemoryFS and explicitly rooted RealFS,
**124/164 strict**, **164/164 original weak selected**, **164/164 diagnostic-
meaning-v2**, **6/6** workflow executions and **16/16** contract groups within
**18/18** Node groups. The **40 strict stderr differences across 20 inputs
remain failures of exact parity**. The 25 native-negative selfchecks and 68
synthetic classifier mutations add no native input coverage. Apple-secondary
52/142 strict and 66/142 weak-selected observations remain distinct.

The historical separate dangling-output 2/2 regression is not relabeled as a
current replay of its duplicate-install runner. The author packed suite has a
separate default MemoryFS dangling-output test; it is not an independent native
case. Historical `FINAL_HANDOFF.md`, release.json, assertions and all initial
failures are preserved without editing.

## Evidence and remaining ownership

Final qualified follow-up selected source
`d5a5a271d1ace4497990ca8ee38da3903a8a5285`, ran from
2026-08-27T07:35:40.885Z to 2026-08-27T07:36:04.162Z, and returned zero.
The source/package/configuration manifest SHA256 is
`c6811ab9b02bd0af484231ea0fc993ede269b3d6b5d8c6a97478498853e14152`;
two identical final packages have SHA256
`cc46e857180765d75b81c1c3d65dd2cdf7c1e07df998b0260f71fab10050253a`.
All counts above repeat unchanged, including 124/164 strict, 318/318 metadata,
18/18 stream groups, 31/31 registry and 21/21 moved consumer tests. The seven
negative public type errors are expected, not verification failures. Both
copied-asset negative controls again return78 before any product execution.
`evidence/final-*` records exact commands, current profile, native setup,
636 built-file SHA256s, raw stream comparisons and strong classifier results.
Evidence-only follow-up commits do not change the selected source or harness.

The initial inspection used `0487969`, but the baseline test captured HEAD
`bf8b554`; the raw baseline has always recorded that exact commit. This text
corrects the earlier summary's inspection/run conflation. Between the first
successful release `dbe3cfd` and final selected source `d5a5a27`, another owner's
`07acb1a` changes `src/contracts/command.ts` and `command.md` with cooperative
invocation cleanup. It is retained and covered by the final source manifest,
not attributed to this stream author. These different full source hashes are
not represented as identical repository trees.

`evidence/` retains the original baseline/stale failures, initial snapshot
preparation fault, initial successful current release, negative controls, and
the final follow-up source/harness/artifact inventories. Reports distinguish
source commit, current workspace HEAD/index observation and execution time.
Only owned evidence is published; native binaries, archives, fixtures' scratch
directories and packed artifacts remain uncommitted in isolated `.runs/`.

Other active test migrations were routed to root without editing their paths:
`tests/integration/stream-inspection-public-author/public.test.ts`, its
`consumer.mts`, `tests/commands/stream-format/helpers.ts`,
`tests/commands/stream-format-author-stress/contracts.test.ts`, and
`tests/commands/split/integration.test.ts`. Their historical count/helper
assumptions are not silently counted as current passes here. No reviewer
holdout input was inspected. A different verifier must review the final closed
author source; no full gate, superiority, deployed-provider or 72-hour
completion claim follows from this integration.
