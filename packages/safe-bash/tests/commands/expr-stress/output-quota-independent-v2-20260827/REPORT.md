# Expr quota v2 — independent pinned review

**Scoped current-policy acceptance supported; unchanged canonical cohort remains
46/47, not 47/47. New independent cohort is 21/21.** Both candidate replays agree.
The single original assertion conflict is retained explicitly below. No product,
global contract, old fixture or historical evidence was changed by this leaf.

## Freeze and source binding

- Freeze commit: `2fc54ff3`; baseline evidence commit: `21ffdf1e`.
- Controls frozen at **2026-08-27T20:49:13.356Z**, before reading the candidate
  receipt or candidate source. The committed freeze was published in
  `/tmp/expr-quota-independent-v2-20260827-freeze.txt` before baseline execution.
- Exact canonical old cases/probe/helper are byte-identical copies from
  `064f3381`. Original results are preserved, not rewritten or rescored.
- Historical baseline: `7623599c995c42f62ec1cd9ad78ced2913970f66`.
- Exact author candidate: `c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`.
  The receipt arrived after the baseline finished. The receipt is stored in
  `CANDIDATE-RECEIPT.txt` as provenance only; author test counts are not acceptance.
- Candidate selected-archive SHA256:
  `150c509d7c4f22032568eef007585955b0d7b48eeeaa9f39d709325f7c7fcf62`.
  Selection includes committed source/config and four existing scoped tests plus
  their helper, not the author's new regression suite or old evidence tree.
- Host: Node v22.22.2, Darwin arm64. Every replay builds its own selected Git
  archive and imports that compiled source and actual compiled worker. Later
  live edits to expr index were observed by status only and never overlaid.

## Exact denominators

| Cohort | Historical baseline replay | Candidate run 1 | Candidate run 2 |
| --- | ---: | ---: | ---: |
| Original unchanged 47 | 36/47 | 46/47 | 46/47 |
| Frozen new 21 | 10/21 | 21/21 | 21/21 |

The baseline reproduces all **11** original failing rows. Candidate repairs all
observed normal-quota violations; ten original rows turn green. The remaining
original `stdout-rejection-normal-quota` still fails its original result oracle:
it expects an emergency/status result after a stdout sink rejection, while the
new user policy requires the exact original sink rejection with no diagnostic.
Candidate actually rejects with the identical sink Error object after one
2-byte stdout attempt and **zero** stderr attempts. Its original quota and
cleanup assertions pass; its original result assertion remains red.

`v2-old-stdout-rejection-explicit-identity` is a separately frozen, explicitly
proposed versioned control. It passes in both candidate runs. It does not replace,
edit or retroactively green the original. Current-policy observations therefore
comprise the 46 nonconflicting original controls, this one versioned identity
proposal and the other 20 new controls. Repetition is reproducibility, not a
doubled independent denominator or a full-gate pass.

## Boundary, identity and cleanup observations

- The **44-byte normal syntax diagnostic** is rejected at cap **43**, emitting
  only the fixed 34-byte emergency with status 3; cap **44** admits exactly the
  normal diagnostic with status 2. Old cap sweep, attacker tokens/command name,
  normal awaited write, rejection and Shell controls remain unchanged.
- Division normal bytes are admitted at cap 23 and replaced by the fixed
  emergency at cap 22 and cap 1. Modulo, noninteger, NUL, malformed Unicode,
  argv/work-budget and invalid-worker-regex normal errors obey small caps.
  New NUL diagnostic at cap 128 confirms normal error status/text remain intact.
- This is a **normal-output budget plus at most one exact fixed emergency**,
  not an absolute combined stdout/stderr limit. Other 34-byte diagnostic strings
  do not acquire an exemption. At cap 1, a throwing stdout sink is never called;
  actual admission happens before writing. Exact stdout-boundary success and
  false-result controls remain green.
- New stdout sink reasons `0`, `false`, `null`, `undefined`, empty string,
  a normal Error and an ExprError with the quota message preserve identity.
  They are not reclassified as quota or generic execution failures. Falsy
  normal/emergency stderr rejection and real-worker sink rejection preserve
  identity too, without a duplicate emergency attempt.
- Old held stdout/normal/emergency sinks stay awaited. New abort-during-emergency
  with reason `false` retains caller identity and observes a later sink rejection.
  Worker post-admission abort reasons `false` and `null` retain caller precedence.
- A controlled delayed session close runs actual worker cleanup first, then
  holds completion. Both invocation and registered cleanup remain unsettled
  until release; overlapping and repeated cleanups share completion. Sink
  rejection `undefined` and caller abort `false` take precedence over a separate
  injected close failure. An otherwise completed worker diagnostic preserves
  the close failure instead of recasting it as quota. Each session closes once.
- The long attacker-token allocation control observes TextEncoder diagnostics
  and finds no over-cap normal diagnostic encoding. This is a bounded byte-
  encoding/admission observation, not total heap/RSS or all string allocations.

## Independent build and source review

All three source/declaration builds and scoped strict typechecks pass with
`--skipLibCheck false`. Scoped typechecks compile the committed existing
contracts, abort-reason-regression, regex-lifecycle and regex-protocol tests plus
their helper. Those four suites were **compiled, not run**. Runtime acceptance
comes from the independent old47/new21 probes, including actual worker jobs and
three old Shell invocations. No native oracle is run or recaptured.

Both candidate full build inventories are byte-identical, including declarations,
worker code and source maps. `REPEAT-AUDIT.json` records exact source/build hashes:

| Artifact | Candidate SHA256 |
| --- | --- |
| src/commands/expr/index.ts | b1ad46e35f4077659aee2d148ab30a1ac6ba4032a877669ae2c5bfb27447c7fa |
| dist/commands/expr/index.js | 719a60ebfbe659f4411aef28ea6c443320afcb8e9ea5df10f047ce8877969957 |
| dist/commands/expr/index.d.ts | bc5ad271ac3d86ed7fe5ed04b59b2541578f52c91695b3288a369d3d1cd2af44 |
| dist/commands/regex-execution/worker.js | 46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f |
| dist/commands/expr/bre-worker.js | e744453f4430b6a929cadac4e4b6a8a4e58ac75440ef16006ff4f4dab31f4874 |

Source hash matches the author's receipt. Declaration/worker hashes are unchanged
from baseline. `SOURCE-AUDIT.json` records the exact commit patch and critical
source hashes. The quota commit changes **only expr index in production source**
and adds one author test file. Parser, evaluator, budget implementation, worker,
global contracts, root exports and package/lock are unchanged. No new runtime
dependency, public API or main-thread regex execution is introduced. Runtime
import hooks forbid main-thread matcher/compiler modules; all observed jobs use
the selected build's real worker. These bounds are not a JavaScript sandbox proof.

The historical baseline predates two unrelated committed html-to-markdown source/
README changes present in the candidate archive. They are disclosed in the source
audit; the quota commit itself does not change them. No HTML acceptance is claimed.

## Safety, preservation and reproduction

All six probe processes exit normally with empty stderr. Each records **zero
unhandled rejections**, **zero main-thread matcher violations**, **zero workers
at settlement/after cleanup**, and **zero safety terminations**. New probes record
zero uncaught exceptions. The byte-identical old probe has no uncaught monitor;
its normal process exit/status/stderr provide process-level evidence, not a newly
invented monitor. All task-owned scratch directories are absent after cleanup.
No SIGSTOP, unbounded job, unrelated child cleanup or competing full suite ran.

Full post-run entry-set equality covers source/build, development dependencies
and all three historical evidence directories, including appended entries.
Frozen driver files are checked by their explicit hash list; that list alone
does not detect additional files. Archive tar hashes are checked before/after. These are observation-time
checks, not prevention of transient mutation. Native temporary artifacts and
other owners' staging/edits are untouched. `SEAL.json` binds this review's full
entry set excluding itself; verification detects appended entries too.

Run `node tests/commands/expr-stress/output-quota-independent-v2-20260827/verify.mjs --verify`
to verify the seal, unchanged freeze/history, exact counts and recorded safety
without executing product tests or writing historical captures. Explicit replay
uses `replay.mjs --capture NEW-LABEL c25e682a7baa2f2abf70cebf8c01d11d0ad5daee`
in a separate authorized copy: it requires a fresh destination and exact frozen
dependencies. Adding a capture changes the sealed entry set. Do not silently
rebind to later HEAD, including later parser changes.

Baseline runtime: **20:49:22.114–20:49:30.280 UTC**. Candidate runs:
**20:51:36.679–20:51:45.020** and **20:52:08.787–20:52:15.531 UTC**, August 27,
2026. This records actual scoped work, not 72 hours, complete project acceptance,
universal parity, performance, deployed-provider acceptance or superiority.
