# Alias settlement v2 — closed author handoff

**Author replay passes 82/82; independent acceptance and root integration remain
HOLD.** This is a separately labeled fixture-v2 result, not a relabeling of the
immutable prior 80/82 replay. A different reviewer must inspect these two
expectation changes and the sealed execution. No product source changed.

## Boundary and pre-execution freeze

`BOUNDARY.md` records the exact 0123 source paths, line numbers, Git blobs and
SHA-256 identities inspected before fixture authorship. Public Shell closes
external stdin after the handler returns: `src/shell/shell.ts:174` propagates the
normal-completion close failure before constructing ShellResult; public exec at
`src/shell/shell.ts:103` preserves its selected rejection. Cursor return handling
is `src/shell/input.ts:61`. This differs from grep's handler-level status-2 error
paths at `src/commands/grep.ts:77` and `src/commands/grep.ts:85`, which are unchanged.
This is the root-authorized contract correction, not a compatibility waiver.

Preparation commit **8b89c0e76dfe581ce57418b391e74ce299686af7** froze the patch,
derivation helper, boundary report and initial authentication before any v2
product run. It changes only:

- S07 / `borrowed-external-Shell-stdin-return-rejection-not-waived`.
- ROOT-CONTROL / `public-registered-grep-reproduces-external-return-failure`.

Both require rejected settlement, the **identical sentinel object**, no fulfilled
result, and the existing one-return count. The patch records rejection
name/message/stack/identity; unexpected fulfilled results retain their entire
ShellResult. A rejected exec has no returned stdout/stderr/status, so none are
fabricated. No extra byte observer, middleware or weaker assertion is introduced.
Existing return/next counts, alias-registration observations, finally disposal,
worker and unhandled-error checks remain. All direct-handler status-2 checks,
other byte/VFS effects, names, inputs, limits and native capture values remain.

- Original fixture SHA-256: `d454002f97fa37b6546bad238feec5472774646a6bf0d766fea32c2c0c32977b`.
- Two-hunk patch SHA-256: `9af570eb8126652e26ddd7ed1d3ac88dcad646cb822e0eca12fc89c0538aa36a`.
- Derived fixture SHA-256: `41fb87e021e9d851905e889e26beaad4a779336b787e665b21c76bbace5f8850`.
- Unchanged remainder SHA-256: `f034cbd3570f36d1dc968123d5c3f8bafc72cab73687bc31ed67b85de7e9e9d5`.

Reverse application reproduces every original fixture byte. Only the two
authorized spans differ; the other 75 base cases and five supplemental cases
retain their original bytes/assertions. The original fixture and consumers were
never patched in place. The minimal artifact is applied to a fresh copy with
apply_patch; all original source/test/native/evidence seals remain unchanged.

## Exact product and load binding

Candidate: **0123c83d3aae72a15621acbb29a165b97b2c6ab6**. The authenticated
whole-candidate archive includes required ancestors f8819e9d, a8096354 and
04644bc2 and the exact input/column/alias identities in `freeze.json`.
All 27,687 committed Git entries, including 12 data symlinks checked without
traversal, were reauthenticated by membership and Git blob hashes. Source files
remain regular. The complete built source inventory, dependencies, original
consumer and new moved package were checked before imports and after each
cohort, detecting additions as well as changes/deletions.

- Archive SHA-256: `64fac38e43ce89009e03d24b8b3dffb8425dd98a313bea4d4133d6db8030cccf`.
- Package SHA-256: `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6`.
- Actual worker SHA-256: `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.

The actual retained offline package was extracted into fresh staging and
physically moved into a new consumer. The original retained consumer remains
read-only. No live source overlay, dependency install, new build or new npm pack
is claimed. The prior successful build/pack receipts and exact source/dependency
bytes were reauthenticated, including candidate lock metadata and cached devtool
tarball integrity. Both new strict consumer compilations pass using those locked
read-only development tools. Runtime dependencies remain empty.

Runtime uses public root Shell and the packed **internal** alias module URL;
no public alias subpath or default registration is claimed. Public resolution
was checked before imports; every actual worker URL matches the authenticated
moved engine. `summary.json` and execution audits include full entry hashes,
resolved URLs, source/package inventory hashes and dependency identities. Live
repository movement is recorded only as context, never used as candidate input.

## Results and preserved observations

| Separately counted cohort | Result |
| --- | --- |
| V2 base product subcases | 77 pass / 0 fail |
| Unchanged supplemental product subcases | 5 pass / 0 fail |
| V2 combined product subcases | **82 pass / 0 fail** |
| Original 38 groups, under v2's two-case correction | 38 pass / 0 fail |
| Historical 154a8d22 replay, unchanged | **80 pass / 2 fail** |
| Assertion-only negative controls | 8 rejected as required |
| Assertion-only positive controls | 2 accepted as required |

Native/profile rows execute unchanged: BSD exact raw tuples 16/26, GNU exact
0/26, GNU stdout/status/VFS projection 26/26. Original warnings stay raw; the
projection excludes stderr and is not parity. These are historical Darwin
C-locale captures, not newly executed native or GNU/Linux references. Native
profiles and signer/prerequisite qualifications remain in their original seals.

Base workers: 86 created/86 exited; supplement: 5/5; total **91/91**. No active
workers, late unhandled errors, timeout, signal or verifier forced termination.
Product-owned retirement remains distinguished from verifier cleanup. Base and
supplement child statuses are both 0. Original 5-second subcase, 120-second base
and 30-second supplemental bounds are unchanged. Registered cleanup, direct/VFS
ownership, byte reuse, backpressure, cumulative budgets, collisions, shadow-grep
bypass and pipelines are the original executed cases, not inferred coverage.

## Assertion controls and disclosed harness correction

Controls compile the **exact patched try/finally body** from each frozen hunk;
their body hashes equal the fixture's actual replacement hashes. For each case,
fulfilled status 0, fulfilled status 2, a wrong Error reason, and an equal-message
different Error object all raise ERR_ASSERTION. The exact sentinel object passes.
All ten controls invoke the same assertion body and finally disposal once. They
use stub settlements, not mutated products, and contribute **zero product passes**.

One capture defect occurred: the first control run wrote its rows to
`assertion-controls.json`, then the supervisor wrote its process receipt to that
same name. The process status 0 remains in `controls/01-process.json`; the first
raw row capture was lost and is not claimed as preserved. Exact controls were
recaptured to a distinct name; `controls/02-process.json` and
`controls/02-results.json` retain that actual result. No product run was retried,
and no product output was overwritten. `attempts/01/replay-source.txt` preserves
the executed supervisor with the collision. The current replay script changes
only the control-output filename; the checker authenticates that exact change.

There was one base run and one supplemental run. Raw stdout/stderr/status,
rejections, recorded VFS effects, worker traces, copied-input hashes and driver
bindings are preserved byte-for-byte under `attempts/01`. Runner copies change
only fixture/consumer location and the supplement's old candidate metadata;
their assertions and watchdogs remain unchanged. `raw-receipts.json` authenticates
each exported capture. No compiler/root/source/default/export configuration was
edited and no global gate, comparison benchmark or native oracle ran.

## Independent review handoff

Review the two-hunk patch first, its pre-run freeze and `BOUNDARY.md`, then raw
results and exact-body controls. Explicit opt-in replay, never canonical discovery:

```
SAFE_BASH_APPLY_PATCH="$(command -v apply_patch)" node tests/commands/grep-aliases-stress/settlement-v2/replay.mjs /tmp/NEW-UNIQUE-SETTLEMENT-V2
node tests/commands/grep-aliases-stress/settlement-v2/verify.mjs --retained-snapshot
```

The verifier audits this sealed capture; without `--retained-snapshot` it does not
require temporary product files. The replay reuses the authenticated retained
package and writes only a new isolated directory. If that prerequisite is absent,
it fails rather than substituting live source or another version.

Root retains independent acceptance, Arch-v2 integration and subsequent 73-wiring
authority. This author issues no public integration GO. Source work and owned
workers are closed. Resume thread: `01a04392-fd24-7870-a9d4-abfdce728e4d`.
