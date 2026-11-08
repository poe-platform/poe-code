# Independent alias verification — HOLD

## Decision and owned source

The bounded alias-only fix is validated, but full acceptance is **HOLD** for the
shared external Shell stdin return-rejection failure. It reproduces both through
egrep and through public registered grep with no aliases. See `ROOT-BLOCKER.md`
for exact behavior, frozen source location and the minimal owner change request.
No shared grep, regex, Shell, runtime, root export, package, default registration
or existing author test has been edited by this verifier.

- Original closed source: `c9bd0dbb05553dc1f1cf9136a4e11ed6a3767bc8`.
- Original alias SHA-256: `61da567865598900545a4bbff2184ce5c68eb0c7e0347e7236e9f92789372c0a`.
- Alias source/regression fix: `04644bc2c15d67155f5f4b170a66fc9bef3f6e3d`.
- Fixed alias SHA-256: `c2333d21c049651a3ef75f811f7c3f516a364d41fdbed2f3683388fba0adbcff`.
- Original 38-row preparation remains immutable at `28a8ad15ada9aa70a828694c53e7dbadc281826a`.
- Separate pre-candidate GNU capture seal commit: `b99c959e`.

Object-spread forwarding dropped accessible inherited context fields and
nonenumerable cleanup hooks. The fix explicitly forwards the current contract
fields and binds optional callbacks to their original host. Six unchanged
regressions (both aliases, inherited fields, nonenumerable cleanup, class getters
and private-state hook receivers) fail on c9bd0dbb and pass on 04644bc2. The alias
still directly executes the shared grep definition with its injected initial
matcher flag. It never redispatches through context.invoke or registered grep.

## Denominators and profiles

Final fixed-05 results, not a sum of retries:

| Cohort | Actual result |
| --- | --- |
| Original native cases | 26/26 executed; 26 bounded-profile passes |
| Exact BSD stdout/stderr/status/files | 16/26 exact; 10 explicit differences |
| Exact GNU stdout/stderr/status/files | 0/26 exact; raw GNU warnings retained |
| GNU stdout/status/files projection only | 26/26; deliberately excludes all stderr, not parity |
| Original safety/Shell groups | 12/12 executed; 11 pass, S07 fails |
| All original holdout groups | 38/38 executed; 37 pass, one fails |
| Additional alias adversarial groups | Five groups, nine passing subcases |
| Separate public registered-grep control | One failing subcase, same shared blocker |
| All final executed subcases | 77 total: 75 pass, two fail |
| Actual final worker lifecycle | 86 created, 86 exit, zero active, zero verifier terminations |

The 26 bounded-profile passes are 16 exact ordinary BSD rows, four explicit
E/F-conflict contract rows and six scoped diagnostic/unsupported-option rows.
These qualified profiles were declared before candidate output. They do not
relabel native differences as exact parity. GNU and BSD are separate Darwin
C-locale references, not GNU/Linux evidence. GNU wrapper warnings remain raw;
the proposed product intentionally does not emit them. GNU's G matcher conflict
and the bounded product's unsupported G option can have equal stdout/status while
different error meaning/wording remains explicit in the raw diagnostics.

The final node:test TAP counts nested group parents as tests as well; use the
77 actual subcases and 38 original groups above, not an inflated sum of parents
and children. Full raw TAP is hex-preserved in each attempt receipt.

## Actual safety coverage

The moved package runs standalone with only the two alias names and no grep;
then repeats with malicious grep registered, which is never invoked. Literal
argv, frozen argv reuse, -e/-f/stdin/files/--/leading-dash patterns, non-UTF8 bytes,
NUL records, statuses and alias diagnostic meaning remain checked. Plugin setup
readiness, collision preflight, explicit replacement, and independent standalone
factories are exercised through actual Shell/registry APIs.

The safety runs include shared maxWorkers one, queue count one and queue bytes
4096, separate-factory two-worker control, queued sibling cancellation, caller
abort before acquisition and during real work, an actual pathological ERE worker
timeout, late input/file/sink rejection observation, cumulative output/command
budgets, bounded owned/borrowed producer reuse, awaited sink backpressure/errors,
registered cleanup before acquisition, cleanup overlap with finally, repeated
dispose barriers, and concurrent sibling ownership. Complex pipelines include
redirected VFS byte readback, pipefail, command substitution, groups and head
early close. Direct and owned-VFS return failures stay distinct from borrowed
Shell input ownership. The original S02 readFile/ByteSource API wording correction
is explicitly recorded in `execution-plan.md`; its fixture bytes are unchanged.

Host postMessage scheduling gates are used only for deterministic queue admission
tests and are disclosed, not represented as throughput measurements. Timeout and
in-flight cancellation controls also execute authentic packed worker code on real
data without those gates. No test or supervisor forces termination to make a
cleanup assertion pass. The complete history has seven candidate subprocesses,
571 actual workers and 571 exits; each test subprocess exits nonzero because the
shared blocker was never waived. There are no cancelled/skipped/TODO final rows.

## API, options and bounded limits

The inspected internal module exports `createGrepAliasCommands`,
`grepAliasCommands`, `egrepCommand`, `fgrepCommand`, and the `GrepAliasOptions`
type. Options are `regex?: RegexExecutionOptions` and `replace?: boolean`.
Family creation shares one existing regex executor between egrep and fgrep;
separately created factories have separate executors. replace defaults to false;
the plugin preflights both names and never registers grep.

Regex options inherited from the inspected contract are requestTimeoutMs,
startupTimeoutMs, maxWorkers, maxQueuedRequests, maxQueuedBytes, idleTimeoutMs,
workerOldGenerationMb and workerStackMb. The main harness uses respectively
1500 ms, 1500 ms, 1, 1, 4096 bytes and 1000 ms for the first six. The actual
pathological request test uses 75 ms. Memory/stack options are declared but not
independently memory-exhaustion-qualified by this cohort.
Shared Shell output budget 6144 bytes and command limits are tested separately
from family queue limits. Per-subcase watchdogs are five seconds and the outer
candidate process bound is 120 seconds; no bound fired. No universal performance,
regex-dialect completeness or host-hard-preemption guarantee is claimed.

The bounded shared matcher set rejects combined E/F flags and does not support G.
BSD accepts the explicit matcher changes in the six profile rows. The native GNU
wrappers inject their own initial matcher flags and warn; their exact diagnostics
remain separately captured. These profiles must be communicated at integration.

## Immutable build and moved-package receipts

Both candidates are regular isolated Git archives of all committed product src
files plus package.json, package-lock.json, README and TypeScript configurations.
Every extracted input is checked against the candidate Git blob. There is no
worktree, synthetic cherry-pick, live-source overlay or dependency installation.
The fixed archive contains 226 inputs, including six other-owner column files
committed since c9bd0dbb; only the alias module changes among this task's product
scope. Shared grep/regex/Shell/root/package files remain c9bd0dbb bytes.

Existing TypeScript 5.9.3, @types/node 22.20.1 and undici-types 6.21.0 are reused
read-only only after every installed file matches an existing cached package
tarball authenticated by the candidate lockfile's SHA-512 integrity. The build
and moved consumer's strict NodeNext types pass. Runtime dependencies remain
empty. No npm install, dependency fetch, private checkout read or whole gate ran.

Offline npm pack ignores lifecycle scripts. The extracted package is physically
moved into an independent consumer directory; its runtime contains the product
package, not devtool symlinks. The source archive, complete package manifest and
individual entries are authenticated before and after candidate execution.
The consumer imports public root Shell and the packed internal alias module URL.
There is **no published alias subpath or root alias-export claim**; Curie still
owns any future integration. A passing internal URL import does not prove exports.

Fixed candidate receipts:

- Archive SHA-256: `0fe44951f6d352ccb851dcbb0c7f73f6192f5c5eff28c57f519b3c8fef8324b2`.
- Package SHA-256: `3757f9f11c9894d94cec8bbd7cdd45380633757f6894a252bdd977e12a5052bb`.
- Public root JS SHA-256: `77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d`.
- Internal alias JS SHA-256: `7ea22cf33cc164d19018bcce4c78e4e519bfc593336a7f5d22459e936e5e94ee`.
- Worker JS SHA-256: `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.

`attempts/pack-*.json` contains full source/package inventories, dependency pins
and raw build commands. Binary Git archive output is represented by a digest,
size and retained isolated path rather than duplicated as text. The complete
original receipt and archive remain at those paths. `attempts/*/receipt.json`
retains raw typecheck/TAP output, source hashes and every attempt's status;
`results.json` retains byte tuples and worker events. Historical harness .txt
snapshots are explicitly captured source data, not canonical TypeScript inputs.
The maintained .mts consumer/test sources are strictly checked on each run.
No test rewrites committed evidence and no test/typecheck exclusion was added.

## GNU trust, reproducibility and stop state

GNU prerequisite builder a767c48e supplied grep 3.12 and its actual generated
egrep/fgrep wrappers. All three executable/wrapper hashes and primary archive
SHA-256 were verified before use and sealed with the same original 26 inputs.
The child PATH is the exact build/src directory followed by /usr/bin:/bin so the
wrappers' bare grep resolves correctly. Two agreeing captures per case plus three
version calls give 55 reaped native children. Source/fixture directories are
owned and exactly removed; no shared temporary directory is deleted.

The builder verified the primary GNU HTTPS archive signature using a GNU HTTPS
keyring. Signer ownership was not independently authenticated. This is a Darwin
build with NLS/PCRE disabled, not a latest-version or GNU/Linux assertion. The
original missing-GNU preparation record and all BSD evidence remain unchanged.

Source work and verifier workers are stopped. Retained isolated archive/pack/log
directories are evidence, not running services. Root must resolve the shared
input failure and supply a new immutable candidate for replay; no GO, full gate,
public-export acceptance, just-bash superiority or completion-duration claim is
made here. Resume thread: `01a04392-fd24-7870-a9d4-abfdce728e4d`.
