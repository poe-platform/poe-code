# Bounded independent metadata runtime review

Independent leaf evidence captured on 2026-08-27 UTC. This directory owns no
production code, original tests, filesystem implementation, or oracle policy.
The full product goal is not complete.

## Result and denominators

| Cohort | Baseline | Closed-source replay |
| --- | --- | --- |
| Original probe, unchanged denominator | 105 equal / 141; 36 different | 135 equal / 141; six different |
| Prepared RealFS chmod counterparts, separate controls | 30 equal / 36; six different | 30 equal / 36; six different |
| Combined probe, not a new original denominator | 135 equal / 177; 42 different | 165 equal / 177; 12 different |
| Original metadata author tests | 43/43 | 43/43 |
| Stress tests | 48/48 | 51/51: original48 + two semantic regressions + one provenance guard |
| Current aggregate-plugin tests | 26/26 | 31/31, root-owned input changed |
| SafeJS-export plugin tests | Not run in baseline | 5/5 |
| Scoped TypeScript, no emission | Exit0 | Exit0 |

Every executed test cohort reports zero failures, cancellations, skips and todos.
The native probe intentionally exits1: remaining differences are **not** waived.
Calibration script exit0 means evidence capture succeeded, not that chmod matched.
Its six host differences are explicitly retained in the evidence.

**Cohort correction:** an early coordination status assumed28 plugin tests;
the archived baseline TAP actually reports26 aggregate-plugin tests. Historical71
was43 metadata +23 aggregate +5 SafeJS. Root archive integration had already
changed the aggregate test, and table-text integration changed it again during
this continuation. Baseline observations are43+26=69, not unchanged71. Final
current observations are43+31+5=79, also not unchanged71. No raw TAP was changed.
All seven original metadata author artifacts retain their recorded hashes.

The original48 stress cases remain byte-identical at their registration bodies:
33 statements, including five complete loop statements generating20 cases.
`final/input-audit.log` records their hashes. New imports and the additional
provenance initialization/guard are distinguished from those original bodies.

## Original36 classification

All30 timestamp differences are **semantic under the user-selected GNU9.7
runtime target**, not calibration-only:15 negative-fraction only, four combined
negative-fraction/width, and11 width only. The original probe already copied
measured RealFS milliseconds to MemoryFS unchanged. Requested Date milliseconds
sometimes differed from actual timestamps by1000ns toward zero, but the native
nanoseconds and actual VFS inputs represented the same instant.

`classifications.json` preserves each original raw row, exact numeric VFS value,
17-digit decimal and IEEE754 representation, native nanoseconds/milliseconds,
submillisecond and submicrosecond remainders, field-level differences and cause.
Observed microsecond alignment is not a general filesystem-resolution guarantee.
After closure, all30 rows reproduce the original native bytes and VFS inputs;
MemoryFS, actual RealFS and deterministic metadata controls each match30/30
(90 controls of the same rows, not90 new utility cases). The unchanged full
timestamp probe matches64/64. `original141.json` is the exact original saved
JSON observation, including the original105/36 result and all36 raw failures.

The six chmod rows all request `u-s,g=s,o-t`, with measured initial modes
04777,0777,01777 on each of a file and directory. Instrumented command calls
request02707. GNU9.7 returns status1 with `Operation not permitted` and leaves
the initial mode unchanged. Virtual MemoryFS returns0 and02707. Virtual RealFS,
direct Node `fs.promises.chmod`, and direct RealFS API calls return success but
realize0707. This is a measured host syscall/status-effect divergence, **not**
a demonstrated symbolic-parser bug and **not** an EPERM waiver.

Captured context: uid/euid501, gid/egid20, supplementary groups exclude0;
fixtures are owned by uid501/gid0; umask027. Read-only `ls -ldeO@` captures
ownership, flags, ACL display and xattrs; no ACL entries are displayed and a
provenance xattr is present. GNU source calls `fchmodat`; RealFS calls Node's
native chmod. This suggests a syscall/backend distinction but does not establish
every kernel-policy cause. **Poincare/root owns the unresolved concern.** No
filesystem source changes were made. Original six differences and six prepared
RealFS counterparts remain separate, including their raw stderr and effects.

## Frozen inputs and provenance

The prepared baseline gate completed before the ready marker released the fixer.
Its before/after digest is
`74391e831d04052eddb8207980f9b3d2769136461105067e34c2cb9ba7b774ac`.
Two unrelated shell files changed after that gate and before the plugin followup;
the combined baseline is not claimed as one closed whole-tree checkpoint.

The final gate began after the fixer's2026-08-27T00:55:58.920Z closure marker.
It checked closure hashes before execution. All540 recorded input hashes remain
identical before/after, including source, installed dependency files, package
files, original author/current stress/plugin inputs, oracle pins and replay
scripts. Both manifests observe HEAD `565638a655d808d27961df57cc222dfd9ac22dfd`.
Digest: `d08b8a3eee0007c838700c824f95485dc767f41a3a610349f1935695ac6cad33`.
Final `stat.ts`: `21f4e1bd5f938f33f41ea9976fbd5b2e00fbe3a7b80cb99c8ecc03131900d860`.
Exact per-file hashes and commands are in `final/before.json`, `final/after.json`
and `final/execution.json`; metadata/author hashes are repeated in `REVIEW.json`.
This is a bounded source snapshot, not a clean whole-repository validation.

Changes remain independently attributed:

- `2cacd04`: negative-fraction production fix and regression.
- `0c4709f`: narrow-width production fix and regression.
- `220cd7e`: source-evidence hash correction and provenance guard, not a source fix.
- `2e3ae8f`: fixer's evidence/documentation closure.
- This directory: independent evidence, input audit and replay only.

The malformed recorded62-character `stat.c` hash is retained in
`stat-source-provenance.json`. Independent hashing of the local file and the
single archive member both yields the actual64-character value
`32c77c3620837a73dc0ed72dc7ee874f8e52946c8c8c2c4b2255e4f41bea6bad`.
The pinned archive and all three binary hashes are unchanged. No archive
signature verification, rebuild or binary modification is claimed.

Primary sources retained separately from runtime acceptance:

- GNU archive: https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz
- Current manual, accessed2026-08-27:
  https://www.gnu.org/s/coreutils/manual/html_node/stat-invocation.html
- Manual quote: “When discarding excess precision, timestamps are truncated toward minus infinity.”

The current manual is labeled9.11 and contradicts the selected9.7 executable
for the recorded negative fractions. The user explicitly selected pinned9.7
runtime behavior; no oracle switching or manual-based waiver was applied.

## Replay and boundaries

From the intended repository, with existing development tooling and pinned
`.oracle` artifacts present:

```sh
node tests/commands/metadata-stress/runtime-review/replay.mjs /tmp/safe-bash-metadata-runtime-replay
```

The runner requires `/tmp/safe-bash-metadata-runtime-fixes.closed`, checks its
exact source/evidence hashes and writes new `/tmp` logs using `apply_patch`.
`fixer-closure.json` archives that marker; a future changed source tree must not
be silently described as this frozen checkpoint. `prior-probe.mjs`,
`prior-calibrate.mjs`, `prior-run.mjs`, and `native-count.mjs` are exact copies of
the prepared scripts. `prior-run.mjs` is historical evidence, not the recommended
entry point: it uses the older closure marker and counts only43 author tests.

No new utility corpus, runtime dependency, product native fallback, production
edit, full test audit, diff3758 rerun, root manifest mutation or emitted build
was introduced. Native execution is test-oracle/read-only introspection only.
Historical four unowned TS diagnostics remain root-routed; no fresh global
typecheck claim is made. Precision above3, full GNU/full-shell parity,
just-bash superiority, remote permission enforcement and72-hour completion
remain unestablished.

All reviewer child processes exited normally; active owned processes0. Sentinel
bytes and file contents survived. All known owned fixture paths were verified
absent after cleanup, and no matching reviewer or stress-native directories
remained. The shared oracle and other workers' native artifacts were untouched.
Only this new directory is staged for the independent evidence commit.
