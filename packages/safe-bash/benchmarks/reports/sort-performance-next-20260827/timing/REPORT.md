# TIMING DEFERRED — no qualified local window

August 27, 2026. Author evidence; interpretation and any future timing claims
remain **PENDING a different reviewer routed by root**. No reviewer was scheduled
by this leaf. There is no measured cache speed, regression, overall win, external
comparison, RSS guarantee or superiority claim.

## Outcome and frozen chronology

- Initial harness/fixture/source freeze: `bac58e3e9f11283b95f592080ba43d5e17a859e7`.
- Preserved packaging setup failure: `79ba6f80`. A compiled; npm rejected the
  author's same `/dev/null` config path in two roles. Zero product correctness,
  admission, warmup or timing calls ran in that preparation. See
  `PREPARATION_001.md` and the immutable first `evidence/` capture.
- Corrected preparation freeze: `1cd4da47506cdc7982fd79db7334bbe7ddcd2a2a`.
  Only harness npm configuration/evidence placement changed; the first A build
  was retained. Source bytes, expected fixtures, thresholds and schedule did not.
- Readiness was published before either execution at
  `/tmp/sort-cache-timing-frozen.ready`, then again after all correctness checks
  and before the first load sample. Each publication is retained in its capture.
- All three packages built, packed and moved successfully. **93/93** correctness
  calls passed: 31 independent specimens per package, checking exact awaited
  stdout/stderr bytes, status, and complete flat `/work` effects.
- Exactly **three** admission attempts ran. All failed. **Zero** warmups, cold
  samples or warm timing samples ran. There are no distributions/effect estimates.
- Runner execution bookkeeping: first preparation 6.930 seconds; second execution
  51.991 seconds. These are not command benchmarks or a claim about total author
  work duration. No further load observations or product commands followed.

## Isolation and package identity

All variants share the archived product/configuration tree at
`dce6e3824d6de6d03490a531cf2bc7d2d279bb8c`. B uses only the accepted unkeyed
`text.ts` from `08a26051438f5c6bdde100a4fe724dbb84f6fca4`; C uses only the
accepted keyed `text.ts` from `b4fe4c7868b7ab7067599c6f5d10e99d143aea54`.
These are synthetic common-base packages, not full historical B/C or HEAD.

The 224 source/configuration inventory entries match across variants except for
`src/commands/text.ts`. Exact accepted diffs are `A-B.patch` and `B-C.patch`;
their ordinary unified-diff blank context lines intentionally retain whitespace.
`git diff --check` reports those context spaces in the archived patch file; they
were not altered to make a historical byte capture satisfy formatting rules.

Each moved package contains 733 files. The only differing packed paths in either
pair are `dist/commands/text.js`, its source map, and `text.d.ts.map`.
The public `dist/index.js` and every other packed file match exactly. Each
correctness worker imported `virtual-bash` by name from its moved consumer,
authenticated 174 actual loaded modules against disk and package inventory, and
rechecked package contents after execution. Full source/package/archive checks
also reject new names, rather than checking only previously listed paths.

| Variant | Source `text.ts` SHA256 | Packed tarball SHA256 |
| --- | --- | --- |
| A, no cache | `08a27afc45d2f5a48b082cc2c979e3a13d01fbef42129bc0e72d5477d56a074d` | `4076f21b9754a47d5e35c7db4facc641e56ca1bd47fb3d7c64970895ee96479d` |
| B, unkeyed | `dfc9baed56564395bf90472fd505ea56a8eb5820712c0a5096d95ef2e2db47cc` | `249a95a18925812c38d58d347d81270349ef7b4ff59f8f1d0d10a7b882fe096c` |
| C, keyed | `9a66dc0e320c62aad86d78da9c55580cf6910a537a47db8a330e5122f63a1895` | `7ed758793b74d3c156b4a8a8a47b553206f53123d1e85a6bac4e9ff9bccea11c` |

`frozen.json` binds the archive, inputs, exact scripts, logical cache charges and
source inventories. `evidence-002/prepared.json` contains complete build/package
manifests and tarball locations. `AUTHOR_VERIFICATION.json` records additional
read-only fixture-recipe, name/byte seal, module identity and package-delta checks.

## Host and admission observations

macOS 26.4.1 build 25E253, arm64, Mac17,9, Apple M5 Pro, 15 reported CPUs,
24GiB installed memory. Node v22.22.2; TypeScript 5.9.3; npm 10.9.7. Exact Node,
compiler, npm CLI and top executable hashes are recorded. Local top manual text
is preserved; no web lookup, external oracle or private repository was used.

Each bounded top call returned six raw samples. The first CPU interval was
excluded under the predeclared manual-based rule; **all five** remaining intervals
per attempt were parsed and retained. Attempts ended at 15:44:29, 15:44:41 and
15:44:53 America/Chicago (20:44:29, 20:44:41 and 20:44:53 UTC).

| Attempt | Load1 range | Load5 range | Load15 range | Global busy CPU range | Largest visible competing process CPU |
| --- | --- | --- | --- | --- | --- |
| 1 | 16.61–16.89 | 14.98–15.07 | 11.46–11.51 | 46.77–62.60% | 112.0% |
| 2 | 22.43 | 16.35 | 12.01 | 47.84–68.80% | 106.6% |
| 3 | 21.00–21.08 | 16.24–16.34 | 12.02–12.08 | 51.41–59.55% | 108.6% |

Frozen limits required absolute load1/5/15 <=2/2.5/3, normalized load1 <=.15,
global busy CPU <=10%, CPU range <=5 percentage points, load1 range <=.25,
and every visible competing process CPU <25%. All attempts failed absolute load,
aggregate CPU, competing CPU, and CPU variability; attempt 1 additionally failed
load variability. A high CPU count did not relabel this busy host as quiet.
No causal attribution to a particular agent is made. Top process CPU and global
CPU are different reported metrics; a process percentage above 100 is retained
verbatim, not treated as global utilization.

Raw observations: `evidence-002/admission-{1,2,3}.top.txt`; parsed observations and
frozen qualification outcomes: corresponding `.json` files. No attempt or slow
sample was dropped. During/post-run observations were not applicable because no
attempt admitted measurement. The timer/observer measurement branch consequently
has NOT received an empirical end-to-end timing execution check in this capture.

## Scope, limits and handoff

Frozen campaign budget was 192 warm +32 cold measured commands, 32 warmups and
93 correctness calls (349 total; 34,196,233 fixture input bytes). Only the 93
correctness calls actually ran. The eight proposed timing strata, fixed ABBA
schedule and all guardrails remain specified in `PLAN.md`; they are not results.
Both unkeyed/keyed 8,000-row distinct and duplicate-value profiles, entry/charge
boundary fixtures, precision/stability/unique/reverse/NUL/in-place/borrowed-buffer
checks and plain/b/f/multikey/check controls passed the narrow correctness set.
This does not recertify the full accepted regressions, cancellation/limit surface,
native parity or the historical 48 ineligible mismatches. Those reports are intact.

Both evidence seals were rechecked against exact names and bytes. All owned
children settled: two in the first preparation and twelve in the second, with
no signals required, active workers or test servers remaining. Other agents,
processes, their staging, files and product work were not touched.

Inert artifacts remain at `/private/tmp/sort-cache-timing-EmcEYN`, including the
first failed build, source archive, three source/build trees, moved consumers,
packages and isolated npm cache/config files. The readiness coordination file now
states TIMING DEFERRED and points to `evidence-002/summary.json`.

Root can route this sealed capture to a different reviewer and coordinate a
future window. This runner is intentionally single-use/append-protected: do not
rerun it into either capture or overwrite the existing fixtures. A future owner
must allocate fresh evidence/scratch and explicitly refreeze its execution
identity; no fourth admission attempt is authorized by this completed run.
