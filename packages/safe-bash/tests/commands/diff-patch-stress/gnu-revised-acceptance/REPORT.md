# Separate GNU expectation revision, not original3758 acceptance

**96/96 revised checks pass; original3758 was NOT rerun.** Its retained frozen
result is **3722 pass / 36 fail**, including 34 pruning failures and the two
unchanged expectation conflicts. **Original30 remains 14 pass / 16 fail** from
its literal replay; no test in this directory replaces those original gates.

This leaf changes only this new directory. No original source, test, fixture,
helper, checkpoint runner, or root/FS/contract file was edited. In particular,
`editflows/quoted-safety.test.ts` and `fuzz/edits.test.ts` retain their two failing
assertions byte-for-byte. The preceding `4d4f5ca` checkpoint remains honest.

## Reproduction and fixed denominators

From `/Users/kjopek/Workspace/safe-bash`:

```sh
node tests/commands/diff-patch-stress/gnu-revised-acceptance/run.mjs
node_modules/.bin/tsc --noEmit -p tests/commands/diff-patch-stress/gnu-revised-acceptance/tsconfig.json --pretty false
```

`revised.acceptance.ts` deliberately does not match `.test.ts` discovery. Its
runner explicitly names that file, verifies all **237 pre-existing tracked test
and evidence files**, and compares discovery to exactly the original **70 test
files** from the frozen3758 checkpoint. No skip, cancellation, TODO, filename
filter, or removal changes that census. `original-manifest.json` also records
the original 15 product/documentation file hashes as provenance, not a ban on
subsequent authorized consumer fixes. Only the test/evidence hashes are required
to remain unchanged on future revised runs. The original runner is untouched.

The independent original3758 runner must be invoked separately after the
contracts/backends/consumer handoff. It must still report both original failures,
even if this revised profile passes. Do not add 96 to 3758, silently replace its
expectations, or merge original30 native-negative calibrations into either count.

| Revised checks | Count |
| --- | ---: |
| Pinned GNU diff regeneration of exact first/quoted sections | 3 |
| Pinned GNU patch complete namespace/stream checks | 31 |
| Ordinary product complete namespace/stream/mutation checks | 31 |
| Product-only atomic extension checks | 31 |
| **Total, separately invoked** | **96** |

The 31 fixtures comprise all **17 original malformed-cohort inputs**, four
additional conflict/truncation backup-option controls, six quoted-ancestor
strip/backup-option controls, two selected-final-symlink controls, and two
selected-output-symlink controls. Every fixture runs natively, ordinarily, and
atomically; GNU is never passed `--atomic`. The original 17 input bodies are
extracted read-only and compared against the entire copied literal map, including
the missing terminal LF. Native negative outcomes are successful *observations*,
not successful native edits. The unrelated six traversal/NUL/absolute quoted
security cases are not being reclassified by this revision.

## Native identity and evidence

The existing fail-closed oracle helper checks executable SHA-256, executable
permissions, realpath and exact version before execution. No fallback/install is
permitted. This capture used:

- GNU diffutils **3.12**, SHA-256
  `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`.
- GNU patch **2.8**, SHA-256
  `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
- Native capture: **2026-08-26 22:53:22.820–22:53:23.189 UTC**.
- `evidence.json` SHA-256:
  `0c81e7c2f5202a20a193aff9e72f27f54cf83c33a84b6776b6c146e53683f1eb`.

The acceptance file pins that evidence hash. It records full literal inputs,
argv, both native identities, fixture/source hashes, stdout/stderr, exit status,
all before/after entries (file bytes as hex, symlink targets, mode, inode,
device and link count), plus product write traces. Product observations are
diagnostics, not a golden output oracle: independent expectations spell out
every product write and reject/backup byte. Native checks replay every captured
namespace and stream; unchanged entries retain identity. Directory identity is
checked separately from link counts when new outputs change directory contents.

Every native process is bounded to three seconds and 1 MiB, with literal argv,
C locale, UTC, a private cwd/HOME/TMPDIR, stdin pipe, and no shell. All symlink
targets stay within the fixture root. Traversal never follows symlink entries.
Native host execution exists only in tests; no dependency, native fallback,
subprocess, or network capability was added to the library.

The GNU primary manual was consulted for strip/backup terminology (sections
"Applying Patches in Other Directories" and "Backup Files"). Precise disputed
behavior is grounded in these locally executed, version/hash-pinned cohorts,
not inferred from broad manual language or from an unpinned platform utility.

## Conflict 1: quoted ancestor selection

The exact original input is a valid first section followed by quoted
`"alias/target"` old/new headers. Initial files are `first`, `target`, and
`dir/target`; `alias` points to `dir`. With no strip option, GNU and both product
modes select basename **target**, exit **0**, and write exactly `first` and
`target` to `new\n`. Full namespaces, alias/referent identities and boundary
sentinel remain intact. No reject or backup appears. Explicit
`--backup-if-mismatch` and `--no-backup-if-mismatch` reproduce that result.

With **-p0**, GNU retains `alias/target`, updates `dir/target` through the
ancestor, and exits 0. Product safety policy instead rejects the selected
ancestor with status **2**, an exact symlink diagnostic and **zero writes**,
including no first-section commit. Both ordinary and atomic modes are checked.
This is an explicit security-policy divergence, not GNU namespace parity.

Two further controls select a final alias or make stripped basename `target`
itself a symlink. Product rejects both before effects. GNU refuses that final
file with status 1 after the valid first section and creates the corresponding
reject. Their exact rejects, original links and referents are all asserted.
Default stripping therefore never authorizes following a *selected* symlink.

## Conflict 2: complete misordered hunk versus truncated syntax

The repeated complete `@@ -1 +1 @@` second hunk is an applicability conflict.
Pinned GNU and ordinary product exit **1** with identical stdout/stderr and:

- `first` becomes `changed\n`;
- `target` becomes `new\nmiddle\ntail\n`;
- `target.orig` contains exactly `old\nmiddle\ntail\n`;
- `target.rej` contains exactly the rejected `old` to `other` hunk;
- every other namespace entry remains unchanged.

Explicit backup-if-mismatch gives the same result; no-backup-if-mismatch removes
only the backup from that expected namespace. Atomic product exits **1**, emits
the hunk-2 conflict diagnostic, performs zero writes and preserves the entire
original namespace. No rejected hunk was swallowed or reclassified as syntax.

The genuinely truncated `@@ -1 +1,2 @@` control exits **2** natively and in
both product modes. GNU and ordinary product commit only `first` and retain
`target`; GNU announces the target before the parse error while product does
not, so diagnostic equality is not claimed. Atomic product preserves everything.
Default, explicit mismatch-backup and no-backup profiles retain no backup/reject
for the malformed target.

All original malformed inputs remain visible; none is silently excluded:

| Original suffix | GNU | Ordinary | Atomic |
| --- | ---: | ---: | ---: |
| missing-old-body | 2 | 2 | 2 |
| missing-new-body | 2 | 2 | 2 |
| extra-old-body | 2 | 2 | 2 |
| extra-new-body | 0 | 2 | 2 |
| zero-count-noop | 2 | 2 | 2 |
| zero-start-nonempty | 0 | 2 | 2 |
| negative-count | 2 | 2 | 2 |
| noninteger-count | 2 | 2 | 2 |
| orphan-newline-marker | 0 | 2 | 2 |
| duplicate-newline-marker | 0 | 2 | 2 |
| empty-incomplete-line | 0 | 2 | 2 |
| content-after-incomplete-old | 2 | 2 | 2 |
| content-after-incomplete-new | 2 | 2 | 2 |
| backward-second-hunk | 1 | 1 | 1 |
| missing-physical-newline | 2 | 2 | 2 |
| header-only | 0 | 2 | 2 |
| context-only-hunk | 2 | 2 | 2 |

Thus **six of these 17** are accepted by GNU but remain rejected by the product.
They are not new dialect exceptions or claimed compatibility successes. Their
full native and product effects are retained: ordinary extra-new-body commits
both files before its trailing-input error; missing physical LF prevents every
product write although GNU commits `first`; other product syntax errors retain
only the committed first section. All 16 product syntax cases leave atomic state
unchanged. The selected grammar policy and differing parse/application error
precedence remain distinct from the single complete-hunk revision.

Selected backup/reject symlink controls also preserve honest partial effects:
ordinary product commits `first`, then reports status 2 before changing target,
link or referent. Atomic mode encounters the conflict first and returns 1 with
zero writes. GNU replaces the output link with a regular backup/reject, does not
write its sentinel referent, and returns 1. These are explicit security and
atomic-policy differences, not status-only parity.

## Validation and handoff

The accepted revised run is `/tmp/safe-bash-diff-revised-run-jOJyEB`,
**2026-08-26 22:56:46.434–22:56:47.209 UTC**, Node **22.22.2**, darwin/arm64.
All scoped inputs were identical before/after; all 237 original test/evidence
hashes and the 70-file original discovery matched. TAP SHA-256:
`ba1d48e7925959ab5d18bc2593f6a66c99407ed797da577de53b2cc87f5c2dbc`;
stderr was empty. `summary.json` preserves per-input hashes and command argv.

Scoped `tsc --noEmit` passed with empty output. The live whole-repository
`npm run typecheck -- --noEmit --pretty false` returned **2**, with unrelated
errors in `tests/commands/network-stress/close-resources.ts:20` (Error.code) and
`tests/fs/readonly/conformance.test.ts:70` plus `readonly.test.ts:43` (old
recursive options passed to newly narrowed FsOptions). No unrelated fixes were
made. The global log is `/tmp/safe-bash-diff-revised-live-types.log`, SHA-256
`80b34cadce76444b946f770e88f27c4d8212c5bc5497e20f280efab541d6b039`.
No build or emitting compiler call ran; no JS siblings were created.

One preliminary revised test run was **95/96**, because its newly authored
duplicate-marker diagnostic expected ordinary rather than atomic parse-error
precedence. The already captured evidence showed the distinction; only the new
assertion was corrected. That failed run remains at
`/tmp/safe-bash-diff-revised-run-n2E2Kv`. An initial exploratory capture also
confirmed `-b` is unsupported by this product. Final focused profiles explicitly
test supported mismatch-backup controls instead; no `-b` support is claimed or
implemented. The initial raw capture patch is retained at
`/tmp/safe-bash-diff-revised-native.patch` (SHA-256
`0f377090240a4b2f649c34fb2a2251c328e4c8c38cd008ca8211281b5fb47841`).

Minimum FS request was written first to
`/tmp/safe-bash-diff-fs-request.txt`, addressed to Curie/Poincare **for root
routing**. File creation is not proof of receipt. Curie's later committed
`1dc0652` supplies exact optional API
`FileSystem.rmdir?(path: string, options?: FsOptions): Promise<void>`.
Memory/Real implementations appeared in progress; this leaf did not assert
backend readiness or edit any consumer. A separate root-assigned consumer worker
is waiting for root release and owns that followup. Root must route unsupported,
error/race and cancellation policy explicitly: no recursive rm fallback and no
silent failed-pruning diagnostics. The original3758 rerun stays gated on that
backend/consumer handoff and remains the independent verifier's task.

No test/native/build process from this leaf remains active at handoff. This is
not full GNU/BSD compatibility, a passing original3758 checkpoint, full shell
completion, superiority over just-bash, or evidence of 72 hours of work.
