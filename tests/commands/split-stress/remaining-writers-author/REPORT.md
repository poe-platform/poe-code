# Remaining split writers: bounded author repair evidence

Candidate: **79f11f1526224a1f34ffd64d7a32c63bdb971a0d**.
Parent: `8784a8fc0484313b914fe1ae6db33a8cfd0e0be4`.
This is author test/harness evidence, not independent acceptance. The different
reviewer handoff was published promptly at `/tmp/split-remaining-writers-candidate.txt`.
No full gate ran; **frozen8670 remains UNQUALIFIED**. No superiority, universal
parity, completion, 72-hour, GNU/Linux, or deployed-provider claim follows.

## Exact original writer classification

Line numbers here refer to the candidate's parent, not the repaired files.

| Default canonical body | Original writes | Classification |
| --- | --- | --- |
| `tests/commands/split/edge.test.ts:46` | `evidence/` mkdir | Repository allocation attempt, unconditional |
| `tests/commands/split/edge.test.ts:48` | `evidence/edge-initial.json`, `wx` | Unconditional exclusive-create attempt; existing file protected by EEXIST |
| `tests/commands/split/edge.test.ts:49` | `evidence/edge-latest.json` | Truncates/rewrites tracked evidence even when bytes are identical |
| `tests/commands/split/stress.test.ts:46` | `evidence/` mkdir | Repository allocation attempt, unconditional |
| `tests/commands/split/stress.test.ts:48` | `evidence/stress-initial.json`, `wx` | Unconditional exclusive-create attempt; existing file protected by EEXIST |
| `tests/commands/split/stress.test.ts:49` | `evidence/stress-latest.json` | Truncates/rewrites tracked evidence even when bytes are identical |
| `tests/commands/split/dangling-native.test.ts:125` | `evidence/dangling/native-${SPLIT_DANGLING_PHASE ?? "latest"}.json` | Unconditional repository write, not capture gating; unset creates untracked `native-latest.json`, while `initial`/`fixed`/`final` overwrite tracked reports |

Original native scratch was also repository-local: edge lines 21/33, stress line
28, dangling native/RealFS lines 86/102. Writes populating these fixtures were not
report writers; they remain intact, now rooted in isolated OS-temp scratch.
No unsafe original body was executed to demonstrate the defect.

## Repair and unchanged semantics

The three bodies reuse the accepted `createNativeScratch` and
`captureNativeReport` helper, adding only the names `edge`, `stress`, and
`dangling-native` to its allowlist. Their report calls are now edge line 46,
stress line 46, and dangling line 125. Success with the switch unset neither
serializes nor writes reports. Aggregate failures retain lossless base64 JSON in
TAP; `VIRTUAL_BASH_SPLIT_CAPTURE=1` instead exclusively creates a JSON file in a
new private OS-temp directory and prints its path. Any other switch value is
rejected. `SPLIT_DANGLING_PHASE` no longer chooses a destination; author runs set
it to `initial` to verify historical preservation. Existing helper guards and
`wx` publication are reused, not replaced by another capture framework.

All fixture setup, vectors, match predicates, native pins, missing-oracle skips,
and semantic assertions remain. Two final assertion messages now point to
current diagnostics/capture rather than stale initial evidence. Edge native
execution gains the same 10-second bound already used by stress/dangling. Existing
cleanup policy remains: edge and dangling remove their scratch; stress retains a
mismatching row. Direct assertion exceptions can precede aggregate publication;
they still fail with TAP evidence and surviving scratch is reported by the helper.
This does not promise structured JSON for every unexpected exception.

Independent-of-execution TypeScript AST extraction compares all assertion callees
and first two arguments, plus every array literal, against the parent: edge
**4 assertions / 8 arrays**, stress **3 / 13**, dangling **12 / 47**. Exact extracted
expressions are in `freeze.json`; no vector or assertion waiver is applied.
The corpus remains edge 18 vectors, stress 8 native rows with 2 streaming variants
each, and dangling 11 fixtures across 2 VFS backends plus separate GNU/Apple
observations. Repeated runs and injected controls are not additional coverage.

## Commands, native prerequisites, and results

Darwin arm64, Node v22.22.2, installed tsx/TypeScript only; no dependencies installed.
GNU coreutils 9.7 is copied from the local pinned binary into the frozen fixture:

- GNU: `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split`, SHA256
  `cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958`.
- Apple: `/usr/bin/split`, SHA256
  `7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91`.

Both executable identities/modes are retained and hashes checked after execution.
Native fixtures use `LC_ALL=C`, `PATH=/usr/bin:/bin`; no network/service setup.

```sh
env -u VIRTUAL_BASH_SPLIT_CAPTURE TSX_DISABLE_CACHE=1 node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/commands/split/native-capture.test.ts
node_modules/.bin/tsc -p tests/commands/split/tsconfig.json --noEmit
node tests/commands/split-stress/remaining-writers-author/verify.mjs
```

The first two commands use the shared live tree: helper regressions **10 passed,
0 failed, 0 skipped**, scoped TypeScript exit **0**. Their logs are preserved here
and under `/tmp/split-remaining-author-checks-zy0YOl`. The helper reuses its existing
canonical-run framework, now covering all five native files at concurrency 3:
each success mode is 7/0/0; each injected mode is 1 pass/6 expected failures/0 skips.
Added controls check six concurrent new-name publications and exact retained
reports for the three new injected mismatches. Existing destination/symlink guards
are not removed or weakened.

The third command binds **288 exact candidate Git blobs**: all 221 source files,
63 split inputs/evidence, and four root configuration/package inputs. Only installed
tooling is linked; GNU is an authenticated copy. A separate reporting-control copy
changes only three observed-exit-status sites. Source, fixtures, expectations,
helpers, and native identities do not change in the injected copy.

| Frozen cohort | Pass | Fail | Skip | Captures | Retained scratch | Observed mutation attempts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Canonical default | 3 | 0 | 0 | 0 | 0 | 239 |
| Canonical explicit capture | 3 | 0 | 0 | 3 | 0 | 245 |
| Injected default | 0 | 3 expected | 0 | 0 | 1 | 238 |
| Injected explicit capture | 0 | 3 expected | 0 | 3 | 1 | 244 |

All canonical mutation attempts target their owned OS-temp subtree. The default
success TMPDIR is empty afterward; default negatives retain exactly one stress
scratch and three complete base64 TAP reports. Explicit modes retain three distinct
0700 directories with exclusive 0600 JSON files each. All captures and retained
scratch destinations across modes are distinct. Complete inputs/logs/captures remain:

`/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/virtual-bash-split-remaining-author-6vNKza`

Freeze preparation/execution spans **2026-08-27 15:50:33.148–15:50:42.856 UTC**.
Reused reviewer barriers release six live test-child PIDs together for each pair:
canonical 67991–67996 at 15:50:40.931 UTC; injected 68142–68147 at the recorded
second release. This proves overlapping child lifetimes/admission, not simultaneous
CPU instructions. Each parent admits at most three files, with a 120-second process
group bound and 16 MiB output limit. All six parent and twelve test-child PIDs were
absent at completion; no owned process remains.

## Write-target negatives and integrity

`write-guard.mjs` observes the actual `node:fs/promises` mutation APIs used by these
bodies and RealFS, including writable `open`. It rejects destinations outside the
mode's real OS-temp tree before calling the underlying API. Two deliberate controls
attempt an **identical-byte** write to frozen historical `edge-latest.json`: directly
and through an in-temp symlink alias. Both are recorded and rejected; bytes remain
unchanged. This is stronger evidence than hash-only checks for identical rewrites.
It is not a syscall monitor, a malicious-host sandbox, or an atomic namespace-race
defense. Native subprocess effects are qualified separately by their isolated cwd,
inspected unchanged fixtures/pinned tools, and complete frozen-tree integrity.

The accepted review's `guards.mjs` is reused unchanged against the candidate helper:
**23 passed / 0 failed**. It covers default nonserialization/failure round-trip,
wrongdestination/path-valued switch, invalid names, repository TMPDIR/symlink
aliases, concurrent factories, replaced-directory and directory-symlink rejection,
existing files/output symlinks/dangling symlinks, and repeat-publication refusal.
The guards process is not instrumented by the author observer; its own real-fs
assertions provide that separate evidence.

Both frozen copy inventories are unchanged after execution, including bytes,
modes and new-entry enumeration. Live history is also re-enumerated and unchanged:
44 split evidence files, 17 earlier author files, 18 accepted reviewer files, and
29 frozen8670 files. These are integrity witnesses, not rescoring of old runs.
The product source tree is identical parent/candidate:
`47344a45c69235dddb6f71ad6a63b77e95c3c229`; the split evidence Git tree is likewise
identical: `2e86c2091a44387fa009b92f7325308e34f3df28`.

New edge and stress captures are **raw byte-identical** to their historical latest
reports. Dangling matches historical `native-final.json` after replacing only the
execution timestamp; the evaluator additionally permits exact relocated GNU argv0
paths, without changing statuses, diagnostics, fixtures, or byte/namespace effects.
Raw captures remain retained; `results.json` records hashes and comparisons.

`freeze.json` SHA256: `bcd2ecdfdecd375e7ef0b3e2488e33eec56699154891db09f45e50e057dbde8b`.
`results.json` SHA256: `d83fc613b249dd3b993abf62bc04c101338d995fc3ec06a05315b5740276fb94`.
The verifier is single-capture: it refuses overwriting existing evidence files.
Its `results.json` preserves exact stdout/stderr; the empty observer stdout also has
a one-newline `.tap` publication artifact, not an additional executed TAP test.
Both author scripts pass `node --check`. The candidate code passes its scoped
whitespace check. The evidence-wide staged whitespace check flags 16 whitespace-only
lines in the two raw negative TAP logs; those original bytes are intentionally
preserved rather than normalizing failure evidence. Other evidence paths pass.

## Ownership and remaining limits

The initial index was empty and owned sources clean. Existing column, gate-script,
integration, and native-scratch changes belonged to other workers and were not
edited/staged/committed. Concurrent commits can change the live HEAD; frozen input
blobs do not change with it. This does not claim an unchanged entire live workspace.
The initial instruction-read shell loop accidentally shadowed zsh PATH, so `cat`
and `find` failed; a corrected read completed before edits. No native test ran then.

The five-file test/helper commit is separate from this new author-evidence directory.
Root/product files and historical evidence remain read-only throughout this work.
Only owned explicit paths are staged and committed with `git commit --only`.
Different-agent review is still required; this report makes no acceptance claim on
its behalf. Unrelated split tests/scratch writers were not changed or broadly audited.
