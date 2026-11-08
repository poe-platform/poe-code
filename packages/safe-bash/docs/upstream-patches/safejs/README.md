# Isolated SafeJS lifecycle proposal v3 — NOT APPROVED

August 26, 2026. V3 is an isolated **cause-preserving proposal**, not a change to
the accepted API contract, private engine, or shipped virtual-bash plugin. It
repairs v1's outward error shape without inspecting or mutating caller reasons.
V3 corrects only v2's static diagnostic spelling; the full pinned suite now
passes. The original exact-reason identity acceptance and conservative quota
diagnostic still fail. The verifier remains `passed: false`,
exit **1**. No test assertion, denominator or quota was weakened. V1 artifact
bytes are archived in `history/v1/`; its original `evidence/` files are unchanged.
V2 patch/manifest and former reason fixture are in `history/v2/`, with its failed
results retained in `evidence/v2/`. Stable executable checkpoint, emitted before
documentation expansion: `/tmp/safe-bash-safejs-v3-source-stable.txt`.

## Reproduce safely

Prerequisites: Node.js 22 (observed 22.22.2), the explicit `apply_patch` executable
on `PATH`, existing safe-bash `tsx` development tooling, and the already-installed
workspace tooling in the pinned source snapshot. No dependency installation, network access, worktree,
build, private cache, or private output directory is used. Run from safe-bash:

```sh
node docs/upstream-patches/safejs/verify.mjs /Users/kjopek/Workspace/poe-code \
  --baseline-copy /tmp/safe-bash-safejs-isolated-gnP0gu/baseline
node --test tests/commands/safejs-stress/artifact-guards.probe.mjs
```

The first command intentionally returns **1** for this candidate. It prints fresh
temporary directories, retains exact command/environment records in
`commands.json`, and writes baseline/patched TAP, full upstream JSON/logs, source
hash manifests, and private revision/status comparisons there. The verifier
requires exactly **0 passed / 10 failed / 0 skipped** on baseline before applying
anything, then requires **10 passed / 0 failed / 0 skipped** on patched acceptance.
It continues through supplemental invariants, all 18 reason-safety checks and the
full pinned upstream suite even when patched acceptance fails. The expected
patched acceptance remains **10/10**, not a newly accepted 9/10 contract.
Conformance failures and private drift cannot yield aggregate success.

**Current private engine drift:** the default command without `--baseline-copy`
correctly refuses today's changed private engine before copying/applying. The
explicit source option selects the preserved v1 baseline, verifies all 259 pinned
file hashes without exception, and creates fresh regular-file copies of it.
It is not an in-place target or a guard bypass. Current private engine/revision/
status/index/license are recorded separately before and after copying/testing.
This is validation against the pinned baseline, **not** a rebase or validation of
the newer private engine. A matching preserved snapshot is a real prerequisite;
if unavailable, stop rather than resetting private source or repinning silently.

`--apply-only` creates fresh copies and validates application hashes but does not
run tests; its output explicitly says application only. There is no option to
apply to an input directory or an existing caller-selected destination.

The reproducer pins every non-build/cache engine file in `baseline-hashes.json`,
not just the seven edits. The source can have a newer repository revision only
if those exact engine bytes still match; unrelated dirty state is recorded, not
discarded. Patch SHA256 and before/after hashes are in `patch-manifest.json`.
Application accepts only those seven update-only source paths, rejects traversal,
unexpected operations and symlink targets/ancestors, and uses `apply_patch` in its
own newly created regular-file temporary tree. It verifies the complete resulting
engine manifest. It never edits the input. Temporary copies are retained for
review rather than silently removed.

## Observed results

V3 reproduction: `/tmp/safe-bash-safejs-isolated-ZicyG4`, evidence in `evidence/v3/`.
Targeted testing ran first in fresh `wt42MU`: unchanged run/harness/error-shape
tests **109/109**. V2 remains `pu6gX6`; v1 remains `gnP0gu`. Earlier evidence is
not relabeled as current. See `EVIDENCE.md` for exact commands.

| Gate | Pinned baseline | V1 (historical) | V2 (historical) | V3 |
| --- | --- | --- | --- | --- |
| Same original nine + action-abort | 0 pass / 10 fail | 10 pass / 0 fail | 9 pass / 1 fail | 9 pass / 1 fail |
| Supplemental invariants | 0 pass / 9 fail | 8 pass / 1 fail | 8 pass / 1 fail | 8 pass / 1 fail |
| Reason safety | 0 pass / 18 fail | Not run | 18 pass / 0 fail (v2 literal) | 18 pass / 0 fail (native oracle) |
| Shape audit (part of full suite) | 12 pass / 0 fail | 11 pass / 1 fail | 12 pass / 0 fail | 12 pass / 0 fail |
| Full suite, 125 files | 3225 pass / 0 fail / 38 skip | 3224 pass / 1 fail / 38 skip | 3223 pass / 2 fail / 38 skip | 3225 pass / 0 fail / 38 skip |

The full denominator is **3263 tests**, including all 38 preexisting skips.
The existing root Vitest config, setup, test files, and workspace-source alias
generation are copied unchanged. Aliases resolve only into temporary copied
packages; dependency symlinks are omitted and installed packages are regular-file
copies. Both runs set `SAFEJS_PARSE_FUZZ=1`, `SAFEJS_ADVERSARIAL_SLOW=1`,
`POE_SNAPSHOT_MODE=playback`, and `POE_SNAPSHOT_MISS=error`; each executes:

```sh
node node_modules/vitest/vitest.mjs run packages/safejs/src packages/safejs/test \
  --no-cache --reporter=default --reporter=json --outputFile=<temporary-report.json>
```

No missing runtime prerequisite prevented this full test run. A separate package
`tsc --noEmit --project packages/safejs/tsconfig.json` attempt could not resolve
unbuilt workspace dependency declarations after private symlinks/dist were
excluded; it is **not a passing typecheck**. Vitest uses the copied workspace
source aliases instead. Neither dependency declarations nor build output were
manufactured to hide that limitation.

## What changed, and what remains wrong

- Closure wrappers use the existing branded, frozen `createSandboxClosure`
  factory. Its property callback registers the closure in `seen` before recursive
  property wrapping, preserving cycles and repeated identity. Call/construct,
  static properties, async/name, and original receiver/context are forwarded.
- Retained capture metadata remains private and live via the existing internal
  symbol. **Conservative shared-graph overcounting remains**: a cloned visible
  property graph and original live captures can be charged twice (87 versus 49
  in the diagnostic). This is not a quota bypass. Canonicalizing divergent mutable
  objects merely to satisfy equality could undercount guest or retained growth;
  that broader budget redesign is deliberately not attempted.
- A private WeakMap carries original constructor identity across wrappers for
  existing Map/Set/Error `instanceof` registries. No guest-visible property or host
  capability is added. Known interpreter-branded maps, sets, regexes, generators
  and error objects retain their identity rather than losing internal slots in
  `Object.entries` copying. This is not arbitrary host-object passthrough or a
  new promise of deep cancellation of every nested branded capability.
- Plain copied properties use own data descriptors, including literal and object
  `__proto__`, without invoking inherited setters or changing the prototype.
- Both promise wrappers observe supplied originals before their early-aborted
  rejection. Returned abort rejection is still visible; listener cleanup and
  sandbox promise span metadata survive. Exact null/false reasons are retained.
- V2 changes only `run.ts` relative to v1. Raw preabort primitive reasons remain
  exact; object/function reasons become a new engine-owned `AbortError` with the
  untouched original as non-enumerable `cause`. A fresh internal Budget constructs
  that small error record through `createSubsetErrorValue` with checks suspended;
  caller budget/options getters, parsing and guest/host actions are not used.
  The entry span is an anchor, not evidence a guest expression ran. The outward
  stack is clean; the caller-controlled recursive cause graph is **not sanitized**.
- **Original identity acceptance remains failing:**
  `upstream-desired.probe.ts:37` requires `error === reason`, not cause identity.
  V3 deliberately does not claim these contracts are equivalent or change that
  assertion. A frozen host Error cannot simultaneously retain raw identity,
  remain unmodified and acquire a sanitized stack/source span. Upstream owner
  decision is still required; the local 10/10 acceptance gate is not reduced.
- **V2's two message failures are repaired in v3:** the only new engine edit is
  the fixed string `This operation was aborted`, already required by unchanged
  upstream run/harness tests and independently observed on a default native
  AbortSignal. No caller-reason property is read. The newly authored 18-case
  fixture narrowly replaces its investigator-invented message/stack expectations
  with that native oracle, as explicitly authorized. No original nine, upstream
  test, skip or quota expectation changes.

The durable action-abort child is one Node child per test, with strict rejection
handling, a 256 MiB heap ceiling, 64 KiB captured-output cap, 15-second timeout and
SIGKILL fallback. Baseline catches the outward abort then exits 1 for the original
host promise rejection; patched exits 0 after the observation interval. A separate
bounded child exercises raw and sandbox-promise immediate/delayed rejection,
preexisting promises, exact cancellation reasons and listener cleanup. These are
finite lifecycle regressions, not a host escape or host-evaluator substitute.

The inspected v2 fixture is archived byte-for-byte in `history/v2/`. V3's narrow
oracle correction captures `AbortSignal.abort().reason.message` before engine
import, then uses it for message and stack assertions. Current fixture SHA256:
`83ec16e7e559d8fcf7a24c72b6e278cf1cbb1a2c733d8fd58c8640a0609a7560`. It checks
eight primitive values (including distinct +0/-0), six default/custom/frozen
object/function reasons, two accessor/coercion cases, effect-free setup, and
empty/newline/invalid-source spans. The helper implementation was audited too:
cause attachment/materialization touches only the new wrapper; the span helper
uses entry coordinates and does not parse. These finite tests are not an
independently accepted raw-identity contract or an exhaustive safety proof.

`import-proof.mjs` hooks actual Node module loads, rejects private/wrong-engine
imports, and records real run/interpreter paths and SHA256. The original nine
probe file is unchanged; its SHA256 is
`7f8ebc44fdb3cc313439ec1f3a88c7df3dd3d894b8557daec6c0367fcb7611ab`.
No tool denied this isolated defensive implementation; the earlier denied
additional fixture task was not bypassed.

## License and provenance

Source: the preserved, exact-hash baseline originally copied from
`/Users/kjopek/Workspace/poe-code/packages/safejs`, package `@poe-code/safejs`
0.0.1, `private: true`, with no package-level
license field. The observed repository root `LICENSE` is MIT, copyright
2026 Poe Platform, SHA256
`0f5d2ae231c0461da14b21ac8594071bb51be33e6a3dcc2b105813c69e7f4a13`;
its exact notice is retained in `LICENSE.upstream`. This states observed
provenance, not invented ownership, a separately granted publication permission,
or a claim that the private package is published.

Initial checkpoint revision was `cb9f256b85e5bef78350c425db7d7be8b39a11cc`.
The first successful snapshot observed external advancement to
`031436f3d89ea1df8a33371e30076cb5e44ec262`. Further unrelated private revision and
dirty-status drift occurred during artifact reproduction; exact observations
are preserved. Engine and root-license bytes stayed equal in that reproduction.
Do **not** describe the entire private repository as unchanged throughout this
assignment. Only read-only Git commands with `GIT_OPTIONAL_LOCKS=0` were used.

Historical v1 independent reviewer findings were consumed from
`/tmp/safe-bash-safejs-isolated-security-checkpoint.txt`: separate-copy ten-test
success, the v1 error-shape failure, conservative budget diagnostic,
and guard checks. V2 also consumes the finite abort-shape design report, retained
in `evidence/v2/design-investigation.txt`; that report did not run the full suite.
Final independent v3 review permits **artifact-only archival**, not application,
shipping, upstream merge or an accepted-contract change. Approval remains
**NOT APPROVED**: independently reproduced verifier **exit 1 / `passed: false`**.
The unchanged original nine improve **0/9 → 8/9**, and action-abort **0/1 → 1/1**;
the combined required ten remain **9/10**, reasons **18/18**, invariants **8/9**.
Both independent full suites ran **125 files / 3263 tests: 3225 pass, 0 fail,
38 unchanged skips**. Raw Error identity and conservative quota overcount remain
unresolved; the same eight baseline declaration diagnostics are not a typecheck pass.

See `evidence/v3/independent-review.txt`, `independent-result.txt`,
`independent-proof.json`, and `independent-guard-summary.json` in that directory.
All 20 reviewed executable/probe/helper/provenance hashes stayed stable. The
reviewer's script interval preserved private engine/revision/status/index/license;
the broader **2026-08-26T22:44:55.389Z–22:47:01.175Z** interval preserved engine,
full package, revision, index and license **but dirty status changed externally**
when an untracked document appeared. Earlier drift and current-live-baseline
rejection remain recorded; no globally unchanged whole-assignment claim is made.

The authorized commit archives owned artifacts only. No private-source edits,
runtime dependencies, vendored engine, root exports, package manifests or command
source changes are included. No superiority, full security, universal conformance,
72-hour duration, or product-completion claim follows from this artifact.
