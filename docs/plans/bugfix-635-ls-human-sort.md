# Issue 635: ls human sizes and metadata sorting

## Scope

Assignment resumed on clean `c139b62d7d6613ecc95ae0d26635753854bfc10e`.
GitHub issue 635 was re-fetched: author login exactly `kamilio`, author ID
`MDQ6VXNlcjEwNzgxODU=`, body updated September 5, 2026 at 18:43:32 UTC.
It requests `-h`/`--human-readable`, `-t`/`--sort=time`, and
`-S`/`--sort=size`, including reverse order. Earlier preparation used
`df8595cf668e56be7dcd6fee4d066cfdcfd2ae5a`; it made no implementation edits.

Only the ls member of `packages/safe-bash/src/commands/filesystem.ts`, the new
`tests/commands/ls-human-sort.test.ts`, this plan and an optional ls contract
are owned. Preserve all bytes outside ls, especially canonicalization fixes.
Root owns test registration, full gates and delivery. No README, Git writes,
registry changes, shared builds/dist, typechecks or full lint guards.

Read `packages/safe-bash/AGENTS.md` fully; its observed SHA-256 is
`add0cac1e0c87194a1718dd340a7919119e9aa68ea642979ecd1629f7b6afcfa`.
Use `/tmp/kamilio-toolchain.path`, `/tmp/kamilio-unit-tmp.path`, and
`TSX_DISABLE_CACHE=1`. The validation base pointer is
`/tmp/kamilio-569-575-validation.path`. No external artifacts are needed.

## Sequence and acceptance

1. Add in-memory RED tests for all requested flags, exact size formatting,
   sort precedence, ties/reverse, links, operand groups, headers and limits.
2. Normalize sort options locally, format bounded exact sizes, gather metadata
   once where possible, sort records deterministically and retain VFS errors.
   Keep long-record layout and existing capability/cancellation mechanisms.
3. Run new and adjacent tests uncached, record RED/GREEN, hashes and a byte-exact
   outside-ls comparison with the assigned base. Preserve concurrent changes.
4. Document semantic limits. Raw virtual listing data is not a host terminal UI
   redesign, so no screenshot route or shared build is needed.

## Native preparation evidence

GNU coreutils ls 8.30, `LC_ALL=C`. Controls used Python `os.memfd_create`,
`os.ftruncate`, `os.utime` and inherited `/proc/self/fd/N` descriptors; no disk
fixtures were created. `ls -lnhL` size results:
`1023 -> 1023`, `1024 -> 1.0K`, `1025 -> 1.1K`, `1536 -> 1.5K`,
`10137 -> 9.9K`, `10138 -> 10K`, `10240 -> 10K`, `10241 -> 11K`,
`1047552 -> 1023K`, `1047553 -> 1.0M`, `1048575 -> 1.0M`,
`1048576 -> 1.0M`, `2^30 -> 1.0G`, `2^40 -> 1.0T`, `2^50 -> 1.0P`,
`Number.MAX_SAFE_INTEGER -> 8.0P`.

Three descriptors 3/4/5 had sizes 1/9/9 and mtimes 300/100/100.
`-LS` and `-LtS` returned 4,5,3; `-Lt`, `-LSt`, `-LtSt`, and
`-LS --sort=time` returned 3,4,5. Reverse reversed the tie order too.
Mixed directory/file arguments rendered files first, then a blank line and
directory headers. `-d` sorted all arguments together instead. `-l1` retained
long format, so no unrelated format precedence change is needed.
A command-line symlink to a directory was followed normally, but not with
`-F`, `-d`, or `-l`; explicit `-L` followed it with long format too.

## RED/GREEN

- RED before product edits: 93 tests, 8 pass, 85 fail, zero cancelled/skipped;
  exit 1, 307.255562 ms. Representative failure: `ls -lh` returned 2, not 0.
- Direct current-code controls independently confirmed `-h/-lh`, `-t/-tr`,
  `-S/-Sr` each returned 2 with `invalid option -- 'h'/'t'/'S'`; all three
  requested long forms returned 2 with `unrecognized option`. Stdout was empty.
- Initial isolated node:test launch reported only a file-level failure with
  no case diagnostics. Semantic RED used explicit
  `--experimental-test-isolation=none`; the launcher failure is not semantic
  evidence or a default-runner qualification.
- Before-edit byte observations outside ls: prefix 26165 bytes,
  SHA-256 `ec87a22bf1417774b5875e34cbea347c41abd4a2a73591b009b640090dc7dca2`;
  suffix 236 bytes,
  SHA-256 `be10cafa57bb0611ba6995dd524ac09ee1e8b2b6b34c0aca9c128b75d0dfe8a6`.
- First GREEN: 93/93, exit 0, 325.640556 ms, zero failed/cancelled/skipped.
- First adjacent run: 158/158, exit 0, 483.193005 ms, covering the new file,
  filesystem commands, directory admission and realpath-missing admission.
- Added four passing controls without further product edits: synthetic dots,
  ancestor cycles, one-read file operands and awaited sink backpressure.
- Final normal-isolation run outside the sandbox: 162/162, exit 0,
  1142.14319 ms, zero failed/cancelled/skipped. This includes all 97 new tests
  plus 65 adjacent tests. The initial opaque child-process failure did not
  recur with the same toolchain outside the sandbox; do not mistake it for a
  product failure. This is a focused live-worktree result, not a full gate.

## Differential and scope verification

- A combined current-code/native control compared 16 human size outputs and
  11 sort-option sequences against GNU ls 8.30 (`LC_ALL=C`), using only memfd
  native fixtures and MemoryFileSystem virtual fixtures: all 27 matched.
  Its subsequent read-only Git comparison encountered sandbox `spawnSync git
  EPERM`; that compound invocation therefore exited 1 after the comparisons.
  Preserve that distinction rather than claiming the entire invocation passed.
- The read-only Git comparison was rerun with approval (after one approval
  review timeout). Both text segments outside the ls member were byte-identical
  to `c139b62d7d6613ecc95ae0d26635753854bfc10e`; their hashes are recorded
  above. This preserves canonicalization and every other command's bytes.
- Owned tracked source `git diff --check` exited 0. Source diff: 93 insertions,
  18 deletions, confined to ls. No other production files were edited here.
- Concurrent integration-inputs/search changes were present and left alone.
  No README, registry, Git writes, commits, builds, dist writes, typechecks,
  full tests, lint guards, upstream merge, push or delivery work was performed.
  Root owns registration and all maintained gates; lint remains pending there.

## Reproduction profile

Independent root verification on September 5, 2026 passed all 162 focused
tests with normal isolation (933 ms, no failures, skips or cancellations),
logged in `tmp/issue-635-root-focused.log` under the directory identified by
`/tmp/kamilio-569-575-validation.path`. Root also compared the source outside
the TypeScript AST's sole `define("ls", ...)` call with `c139b62d7`: both
segments are byte-identical. This AST boundary includes different surrounding
whitespace than the worker's recorded segments, so its hashes are separate.
That result is preserved in `tmp/issues-635-643-root-identity.log`.

The two new literal suite registrations passed all 98 integration-registry
tests (8035 ms), logged in `tmp/issues-635-643-registry-root.log`. These checks
do not establish maintained full qualification, remote delivery or release.

Environment for all focused unit executions:

```sh
TOOLCHAIN=$(cat /tmp/kamilio-toolchain.path)
export PATH="$TOOLCHAIN/bin:$PATH"
export TMPDIR=$(cat /tmp/kamilio-unit-tmp.path)
export TSX_DISABLE_CACHE=1
while IFS= read -r variable; do unset "$variable"; done \
  < <(git rev-parse --local-env-vars)
```

The final command, with permission for normal isolated children outside the
sandbox, was:

```sh
timeout 60s "$TOOLCHAIN/bin/node" --max-old-space-size=256 --import tsx \
  --test --test-concurrency=1 --test-reporter=tap \
  packages/safe-bash/tests/commands/ls-human-sort.test.ts \
  packages/safe-bash/tests/commands/filesystem.test.ts \
  packages/safe-bash/tests/commands/directory-admission.test.ts \
  packages/safe-bash/tests/commands/realpath-missing-admission.test.ts
```

Earlier semantic RED/GREEN added `--experimental-test-isolation=none`; RED
ran only the new test file. Output was filtered in memory for failing case
details and TAP totals, preserving command failure through `set -o pipefail`.
No host fixture files, huge copies or persistent external captures were made.

## Handoff hashes and limits

| Owned runtime/test/contract path | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/filesystem.ts` | `b20717015b1fda6730a6f08d51910cde2f68061924e6b0e6b8bbbc3c27d1b022` |
| `packages/safe-bash/tests/commands/ls-human-sort.test.ts` | `08cc5469c3b1c0f500fe3ef05f8f790646727af6c9fdc8dc2d5fa077a1b1da97` |
| `packages/safe-bash/src/contracts/ls-human-sort.md` | `c9c69a679a7f8aa7b8ba0a92ad5e849d611252ee5b7eb76d37901c175d3afad6` |

Human formatting requires nonnegative safe-integer bytes; other sort values,
SI/environment/block-size formatting, host-locale collation, GNU column/total
layout and universal GNU parity remain unsupported. Limits are per-directory,
argv and existing shell budgets, not a global traversal-memory quota or atomic
metadata snapshot. Required metadata is collected before listing records, so
an error can leave a header without entries. Full details are in the new ls
contract. Stop before root registration, maintained gates and commit.
