# Current actual SafeJS integration review — August 27, 2026 UTC

## Scope and frozen inputs

This is a current-engine investigation, independent of Dirac's unapproved
proposal. No product or private source is modified, no upstream patch is applied,
and no private engine is vendored. It is not a whole-product acceptance gate.

- Engine: actual `/Users/kjopek/Workspace/poe-code`, HEAD
  `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, package `@poe-code/safejs@0.0.1`.
- Product and committed review harness:
  `0143ecab8f5c1109b88739e75f6f1022256043ff`, `virtual-bash@0.0.0`.
  The product is a clean archive of that current committed HEAD; unrelated dirty
  archive-worker files are recorded but excluded, not claimed clean.
- Final capture: `2026-08-27T04:30:50.560Z–04:31:09.186Z`.
- Node22.22.2, TypeScript5.9.3, tsx4.23.12, Darwin arm64. Cached Vitest3.2.6 and
  memfs4.57.3 are copied development prerequisites, not new product dependencies.
- Product archive SHA256:
  `d165ca0315cc9f464bd23c1f00ae3888e87d07735ba14f9a1a8e36dd12200a3e`.
- Installed tarball SHA256:
  `fe84fd2baf06bff41c53e481f7cce36af5503deb596699f0540f824a8022859d`.

Machine-readable [checkpoint](../../tests/integration/safejs-current-20260827/evidence/CHECKPOINT.json),
[full report](../../tests/integration/safejs-current-20260827/evidence/final/report.json),
per-case logs/import traces and artifact hashes are under
`tests/integration/safejs-current-20260827/evidence/`.
The two git-history/stat text captures gain one trailing newline on archival;
the artifact manifest retains both original and archived hashes. Behavioral
fixtures, test logs and source manifests are not normalized.
[The harness README](../../tests/integration/safejs-current-20260827/README.md)
contains the explicit opt-in reproduction command and isolation details.

## Actual copies, not private imports or a fake runtime

All264 non-build/cache engine files, including242 under `src`, are copied as
regular files with exact hashes/modes; generated private dist and workspace links
are not used. The isolated product builds, packs and installs offline. Its runtime
dependency map remains empty. Nothing is installed or built in either private
source or the shared product worktree. Child HOME/temp/cache/configuration paths
are temporary; lifecycle scripts are disabled.

Unchanged fixture index imports resolve through the installed public product
root; one existing internal bridge-value helper uses packed dist. Existing
in-memory type probes use only a byte-identical packed-declaration mirror, not
product implementation source. An additional strict consumer uses the public
`virtual-bash` root directly. Engine functions come from actual copied source,
not substituted runners. Fixtures that intentionally use contract runners are
classified separately and never counted as actual engine behavior.

Load hooks enforce the one engine copy and reject private/outside imports and
product-source fallback. Both negative guard controls pass. Engine-enabled cohorts
load61–64 distinct engine files, including the actual run/interpreter; every hash
matches the frozen copy. The no-engine cohort loads zero engine files. Key hashes:

- `src/run.ts`: `243e3ca4efef03f6df73a50ef2f23fdcee4ef07c4e26eca7f498bf7823988e1b`
- `src/interp/interpreter.ts`: `4d33fdba962311153d7cc8ce10d93990fe5db2604513b52fa1f3ea4cbdffc715`
- `src/interp/cancel.ts`: `6e6b5a9a1dc3b58fcdf7e259a3a2e129877bdf97c93b09268ace0084d9e3e97a`
- `src/interp/host-bridge.ts`: `68b91c99f60d971a80cd70996f94d8d1686713dfe3c14ec283ca4e732c457b90`

## Unchanged current results

| Cohort | Pass | Fail | Skip | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Conventional command/stress, original115 | 107 | 8 | 0 | Eight stale defect assertions, not eight new runtime regressions |
| Existing bridges,28 | 28 | 0 | 0 | Includes fixtures and structural typing, not28 guest runs |
| Original nine desired cases | 7 | 2 | 0 | Constructor/static cases fixed upstream; two real gaps remain |
| Additional action-abort child | 0 | 1 | 0 | Real unhandled host rejection terminates strict child |
| Proposal supplementary invariants,9 | 2 | 7 | 0 | Helper metadata/retention and raw cancellation gaps |
| Unapproved proposal reason profile,18 | 0 | 18 | 0 | Separate proposed contract, not18 independent product defects |
| No-engine conventional+bridge,143 | 81 | 0 | 62 | No actual-engine acceptance from these62 skips |

The original inclusive124 cohort is now114 pass/10 fail:107+7 passes, eight
stale characterizations plus two genuine desired failures. The separate action
case is not silently inserted into that historical denominator. Historical
`fa6c095`115 pass/9 fail, including ten passing defect characterizations, remains
unchanged evidence of the older engine, not today's result.

Classification of the115 conventional tests:59 fixture/configuration passes,
45 genuine actual-engine behavior passes, one structural-type pass, and ten
defect characterizations (two still pass because those defects remain; eight now
fail because constructor/static behavior changed). Bridges split into22 fixture
passes, five actual-engine behavior passes and one structural-type pass. Do not
sum overlapping proposal profiles into a product compatibility percentage.

All executable files already present at `fa6c095`, including the nine desired
cases, are byte-identical; only two documentation files changed. Fifteen copied
files match that commit; seven later probe/helper files retain current committed
bytes. No expected output, skip, assertion or product source was changed here.

## What upstream changed

Current `run.ts:294–311` keeps builtin bindings outside the cancellation wrapper
and wraps caller bindings separately. Blame attributes that scope setup to
`0b7d3d23a1`, with the current builtin-binding argument at `3466520aaf`.
The unchanged positive cases now prove `new Error`, `new TypeError`, `new Map`,
`new Set`, `new RegExp`, `Array.isArray` and `Array.from` under a live signal.
Eight old characterization assertions still expecting broken constructors/static
methods therefore fail; they are preserved, not edited into green results.

Current `cancel.ts:138–143` observes an already-rejected input promise in its
pre-abort helper branch. The unchanged supplementary immediate/delayed promise
observation/listener test passes, as does signalled builtin instanceof/error
identity. This does **not** fix the separate host-call bridge branch below.
Upstream replay/randomness/promise-order changes are listed in the frozen
`upstream-history.txt` and `upstream-delta-stat.txt`; no proposal acceptance is inferred.

## Minimal remaining author work

1. **Observe the original host promise on action-triggered abort.** Unchanged
   `action-abort.probe.ts`/`action-abort.child.mjs` sees the outward abort, then
   exits1 under strict unhandled-rejection mode with `host action late rejection`.
   Current `host-bridge.ts:677–686` returns a new rejected promise when already
   aborted without observing the supplied original. A host operation that aborts
   its signal and returns `Promise.reject(...)` reaches this branch. Route a
   minimal current-engine fix plus unchanged child/listener/replay regressions;
   do not suppress process rejection handling or omit the signal in our plugin.
2. **Preserve own special-name data through cancellation wrapping.** The original
   desired `command.env["__proto__"]` case returns no printed bytes rather than
   `literal\n`. The helper invariant also loses the own property. Current
   `cancel.ts:91–95` copies entries with ordinary assignment onto a same-prototype
   object. Preserve own data/prototype/cycles without invoking prototype setters;
   do not sanitize away legitimate keys or change the expected fixture.
3. **Make raw pre-aborted execution refuse before setup.** The original desired
   pure `run("return 42;", { signal: AbortSignal.abort(reason) })` still fulfills
   instead of rejecting; raw null/false/setup guards also fail. The plugin's own
   precheck protects its tested entrypoint, not every direct engine caller. Resolve
   exact reason identity versus a shaped envelope explicitly: the original
   desired case requires the original Error, whereas v3 wraps it as cause. Cause
   equality is not identity. The18 proposed reason cases mostly fail before any
   shaping comparison because execution is not refused; their count is not a
   claim of18 independent bugs or approval of that proposed envelope contract.
4. **Preserve generic wrapped capability metadata and measure quota correctly.**
   Current helper probes lose construct/static self metadata, branded collection
   identity and retained graphs. Measured data size is1 versus23, and1 versus49
   for the shared retained/property graph. The old v3 result87 versus49 was a
   different overcharge; current metadata loss is not that patch behavior. These
   are exact helper observations, not a demonstrated end-to-end guest quota bypass.
   Existing command quota/deadline tests pass. Any broader wrapper fix needs
   independent cancellation/identity/retention testing against this current engine.

These requests belong to a separately authorized external-engine author and
subsequent different verifier. No product workaround or private patch is made.
The seven-file proposal has four mismatching baseline hashes and zero current
files matching proposed output hashes. It cannot be treated as an unchanged
current-engine fix. `0c1bfe2` remains unapproved: historical original8/9,
plus action9/10, invariants8/9 and raw-Error/quota caveats remain historical.
No rebase or proposal application was attempted in this review.

## Typing and packaging limits

The copied product build passes. Both existing actual-factory structural tests
pass. The additional paired strict public consumer has111 baseline diagnostics
and the same111 after assigning real factories to `SafeJsRuntime<Budget>`:
**zero introduced diagnostics**, not a globally clean engine compile. This
profile enables exact optional properties and unchecked-index checking beyond
the upstream package's own configuration; all diagnostics remain in the evidence.

Original-config isolated upstream `tsc --noEmit` exits2 with exactly the same
eight historical diagnostics: missing `@poe-code/frontmatter`, agent-spawn
configs/parallel/types, and two consequent implicit-any parameters. Legitimate
workspace dependency builds/declarations were deliberately not imported from
private dist or fabricated. These are isolated packaging prerequisites, not
proof that the normal private workspace currently fails its own build. Full
engine package/public-consumer build validation remains separate. The inspected
upstream `src/index.ts` already exports run, Budget, makeFsModule and
declareHostOperation; no speculative new export API is needed.

## Working behavior and remaining scope

The fifty existing genuine engine behaviors across conventional/bridge suites
cover actual VFS reads/writes, shared shell pipes/env/cwd/argv, binary stdin/output,
readonly mutations, fatal quotas/deadlines, pending-read cancellation, backpressure,
early-close pipelines, host-call policies and reconciliation refusal for pending
effectful shell replay. Tests use concrete memory VFS or explicit fixture FS/
executors as recorded; they do not establish every remote backend or durable
exactly-once replay. SafeJS remains an explicitly injected optional capability,
with no main private/runtime dependency. Whole-engine slow/fuzz, whole-product
tests, arbitrary-host cancellation and security/superiority claims are out of scope.

## Private state, failed attempts and cleanup

During the final interval, private HEAD, porcelain status, index, selected root
metadata and all copied engine hashes/modes match before/after. Private dirty
package/lock/poe-agent files and existing untracked plans/out/assets remain intact.
Index SHA256 is `2dc2ac516c19864f952c493eb39374db1a2946f359d31dfb6fd02a5fccfb6bc2`
at both observations. This bounded equality is not a claim about unrelated future
worker activity or every untracked/generated private inode. All owned temporary
engine/product/tool trees were removed; no service/server was started.

History retains attempt1's nested cached-tool lookup failure and attempt2's
Node22/tsx mixed-hook CommonJS null-source loader failure. The latter prevented
two entire files from loading and omitted a cached memfs prerequisite, producing
one extra isolated type diagnostic; neither is an engine behavior regression.
The final harness resolves actual cached dependencies and supplies unchanged
copied TypeScript CommonJS bytes without changing fixtures or runtime code.
The relevant primary Node hook caveat is documented at
`https://nodejs.org/api/module.html#caveat-in-the-asynchronous-load-hook` and the
observed mixed-hook issue at `https://github.com/nodejs/node/issues/57327`.

Attempt3 and the committed-harness final run agree on every cohort count,
engine hash and packed tarball hash. Final raw evidence, not partial attempts,
is the current checkpoint. No expected value was tuned; no skip or defect
characterization is promoted to guest success. Broad integration, proposal
approval, superiority and the72-hour goal remain unproven.

## Public-boundary follow-up — August 27, 2026 04:51 UTC

The preceding investigation is preserved as its original snapshot. Its four
raw-engine blocker categories are **not four mandatory product defects**.
The subsequent [public-built-package review](../../tests/integration/safejs-current-20260827/public-boundary/REPORT.md)
separates supported command/FS/shell boundaries from raw engine and unapproved
proposal behavior, using the same actual engine `bb23ec2` in isolated copies.

The unchanged26 public cases originally had two failures from one product cause:
literal own `command.env.__proto__` data was lost. Source `866a6a5` uses a
prototype-free environment dictionary; the packed cases now pass26/26, repeated
at `034a5f0`, with no skipped cases. All six strict-child public cancellation
routes already passed before that fix. Command reason identity is preserved;
direct bridges intentionally sanitize AbortError, while raw engine invocation
around those bridges does not promise original Error identity. Budget/capability
cases do not establish another supported-boundary failure.

Separate test-only `034a5f0` refreshes exactly eight current-engine constructor/
static/thrown-Error assertions, with originals and justification retained.
Final conventional116/116 includes two raw defect characterizations, not116
guest successes; existing bridges28/28 is also a mixed cohort. Original desired
cases are8/9, separate raw action-abort0/1, proposal invariants2/9 and proposed
reason profile0/18. The no-engine62 skips remain non-acceptance. None of these
cohorts is silently merged or used to approve the upstream proposal.

The fixed/repeated package tarball hashes match. Product builds pass; paired
strict consumer checks introduce zero diagnostics over111 baseline, while the
isolated engine still has eight workspace-prerequisite diagnostics. Private
state and engine hashes remain unchanged and execution trees are removed.
The linked report and machine-readable evidence give exact revisions, timestamps,
classifications and bounded upstream requirements. A different reviewer must
verify the public fix and test-only delta; no broad integration closure is claimed.
