# Independent stream-inspection verification

## Gated preparation checkpoint

Independent leaf verifier, distinct from the author; no delegation. Ownership
is restricted to this subtree and verifier-owned temporary evidence. Product,
root integration, defaults, contracts, filesystems and other workers' tests
are unchanged. This is preparation evidence, not a passing product result.

Private holdouts were frozen at **2026-08-27T04:38:31.775Z**, before reading
author implementation or tests and before executing the new source module.
Author source was first inspected after that freeze. Author tests have not
been read or used as an oracle.

| Frozen cohort | Cases |
| --- | ---: |
| tac | 18 |
| expand | 24 |
| fold | 23 |
| strings | 20 |
| Total independent fixtures | 85 |
| GNU coreutils 9.7 Darwin native expectations | 65 |
| Independent specification/contract expectations | 20 |
| Separate Apple native controls, not product assertions | 48 |

The original corpus and native captures remain immutable. One strings
expectation is corrected from primary-source evidence before product
execution; the original and correction are retained separately. Native
captured status, rather than tentative fixture naming, determines whether
option probes are valid. No diagnostic expectation is relaxed to fit product
behavior. No private case contents are published at this checkpoint.

| Private artifact | SHA256 |
| --- | --- |
| cases.json | 956152bcc27f97af0111073f582e9ca0e74199c309ec406b71ca0c022190da75 |
| native-controls.json | 6ea061845c931b1c69e5a9e1a434836ad6af9af37a3688cacad905ffc3fb2e26 |
| intent.json | dcda66b0affa72b2311291ab810b2ad8f0350a8683e92f3b95a9e0c8336683b5 |
| freeze.mjs | a93dce78b747074427a15de10d42485c606f380b520b0cbb5306c348e1b3d6f0 |
| holdouts.test.ts, prepared harness | 211b1df01ba84eb0c54da30dc5d4d95409db745027848b8d57e4ff232b783a32 |
| ORACLE-ADDENDUM.md | df257c76a68dd8f37979812ea37e40d51a7a69cd2a5945a82062c22899253a59 |
| review-snapshot.mjs | 419cfa6f73a4e7d7b56ab760cec96ec5e16d3e43eb11c05e0a4780386cdee6b3 |

Private artifacts live in `/tmp/safe-bash-stream-verifier-20260827-A`.
The author must not inspect them until normal author closure/source freeze.
The prepared test harness typechecks using a virtual repository filename and
`noEmit`, without executing the new module or writing root `dist`.

## Native availability and profiles

Retained GNU 9.7 `tac`, `expand`, and `fold` executables were located through
existing metadata/table evidence despite missing PATH aliases. All three
actually run. Their paths, versions and hashes are published promptly in
`/tmp/safe-bash-stream-batch-native-availability.txt` and frozen privately.
These are GNU executables on Darwin, not GNU/Linux measurements.

Native captures explicitly use `LC_ALL=C`, `TZ=UTC`; two additional cases
use installed `en_US.UTF-8`. Apple controls are separately classified. GNU
strings was not located in the checked installed locations/evidence. No
toolchain was installed or built. Apple strings is not a substitute GNU
oracle; primary GNU manual/source supports the bounded raw-profile expected
data, without a native GNU strings parity claim.

## Resume gate and evidence discipline

Do not execute the new module until root publishes
`/tmp/safe-bash-stream-batch-review.ready` identifying **CLOSED** author commit,
source hashes and interface. At that gate, the prepared snapshot script copies
and hashes source, Shell/VFS/helpers, package metadata and installed loader/
dependencies into a unique private snapshot. It rejects concurrent source
changes during copying. It records actual dirty HEAD, runtime, argv and env.

After closure, publish the unchanged original corpus plus its documented
primary-source correction and prepared tests using `apply_patch`, then replay
against the gated snapshot. Keep original failures and any source-fixer replay
separate. Native fixtures, author tests, byte/chunk tests and contract/budget/
pipeline test groups have separate denominators. Helper failure is not
semantic evidence. Product fixes require root assignment to another worker.

Actual read-only `createAgentCommands()` measurement at
2026-08-27T04:44:23.438Z: **56**, none of these four names present. This confirms
root's explicit profile-coordination correction of the earlier 64 statement;
it does not modify old audit/default-count fixtures or claim integration.

Full user goal, superiority, deployed-provider coverage, 72-hour work target,
public/default integration and batch completion remain open.
# Independent verification result

After confirmed fixer closure, source commit
`335d2c3705b4892a56e807010cd7ca50145fefce` passes **85/85 native-backed selected
semantics** and **39/39 contract groups**. Original literal expectations remain
**84/85**, with the documented lone-dash manual-oracle conflict preserved.
Strict native stdout/stderr/status agreement is **68/85**; seventeen diagnostic
prose differences are not full byte-parity passes. All four reported source
defects are fixed by the separate fixer, not this reviewer.

Final eight-file source manifest:
`4c52a321778aafad0e41b5858d30746d728306e35e26a44554146a69a05c91a0`.
Replay at2026-08-27T05:10:42Z..05:10:45Z uses173 copied source files and495
hashed snapshot entries. Strict noEmit, isolated ESM/declaration build and
post-run source/dependency/config/loader integrity checks pass. No root build
or default/public integration is claimed. See `REVIEW.md` and
`evidence/SUMMARY.json` for original/fixed results and complete attempt counts.
Actual test calls are581 across8 runs, not581 distinct workloads.

## Initial execution checkpoint

Fresh reviewer, distinct from the expired preparation leaf and closed author,
executed the original frozen corpus after root's CLOSED author gate. The
preparation record below is historical, not the current execution status.

- Author source: `4af1b107d4b9449a2c4e7fed467d187448392fd5`; seven-file manifest
  `57c6e29cc6fae6dce5946dddb211b0cc1bf94ef20badb4286546aeafe1e1d553`.
- Original literal expectations: **80/85**; native-backed selected semantics:
  **81/85**. Four valid-native syntax defects remain open pending distinct fixer.
- Separate frozen contract groups: **39/39** after disclosed harness corrections
  (8 reused-buffer/chunk replays plus 31 contract/pipeline groups).
- GNU native strict stdout/stderr/status: **64/85**, not 81/85. Seventeen
  diagnostic-negative cases use command/path/error-meaning assertions, not
  identical GNU diagnostic prose. Four positive cases currently fail.
- All same20 GNU strings2.44 native references were captured before this
  reviewer's source inspection/execution. Nineteen match original specified
  fields; the lone-dash original expectation conflicts with native. Root
  authorized a separate native profile; the original85 stays byte-unchanged.

First failures, raw outputs, actual source/loader/dependency/config hashes,
root gates, original65 GNU9.7 expectations, same20 GNU2.44 supplement, separate48
Apple controls, and each harness version are in `evidence/`. No native fixture
directories, binaries, dependencies or product source are published here.
GNU captures are on Darwin arm64, not GNU/Linux. The original strings metadata
still says unavailable because it records the earlier preparation, not now.

Reproduce the root-authorized native profile on the fixed source:

```sh
STREAM_PROFILE=native node --unhandled-rejections=strict --import tsx --test tests/commands/stream-inspection-stress/holdouts.test.ts
STREAM_PROFILE=original node --unhandled-rejections=strict --import tsx --test --test-name-pattern='^frozen fixture:' tests/commands/stream-inspection-stress/holdouts.test.ts
node tests/commands/stream-inspection-stress/tools/check-evidence.mjs
```

Default profile is native; original explicitly retains its historical dash
failure. These tests import the opt-in source factory through actual Shell, not
root exports/default commands. `tools/` preserves exact environment-specific
capture/snapshot scripts, not portable installers; **do not rerun `freeze.mjs`**
or overwrite the immutable original corpus. No module invokes native commands.

`evidence/HELPER-FAULTS.md` records the failed manifest sort, accidental85 replay,
two exact diagnostic/namespace harness corrections and publisher empty-file
encoding fault. Actual initial test calls:372 (85+85+124+39+39), not372 distinct
cases. Frozen JSON hashes remain unchanged. Empty process stderr is serialized
as JSON string `""`; decode before verifying the recorded raw-byte hash.
Scoped strict noEmit and isolated source-factory ESM/declaration build both pass;
no root build, full suite, public/default integration or superiority claimed.
Raw failure TAP includes node:test indentation-only lines; full whitespace
check reports those retained bytes. Code/docs-only whitespace check is clean.

## Historical preparation record
