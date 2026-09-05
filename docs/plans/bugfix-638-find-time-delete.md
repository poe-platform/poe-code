# Find time predicates and safe deletion (#638)

## Assignment and scope

Implement only `find -delete`, integer `-mtime`/`-mmin` comparisons (including
`+N` and `-N`), and `-newer FILE`. Starting checkout: `a4a53ff99`.
Owned paths are this plan, `packages/safe-bash/src/commands/find.ts`, the new
`packages/safe-bash/tests/commands/find-time-delete.test.ts`, and an optional
`packages/safe-bash/src/contracts/find-time-delete.md`. Root owns canonical
test registration and integration. No README, other source/tests, Git writes,
commits, branches, push, or release work.

## Sequence

1. Add in-memory failing regression tests before implementation.
2. Capture RED results here, then implement minimal expression/traversal changes.
3. Run the new tests and adjacent find tests uncached; record GREEN and scoped
   lint evidence. Do not claim a frozen checkout or full-suite qualification.
4. Document supported semantics and explicit limitations; return owned paths.

## Acceptance

- Capture one invocation time; preserve GNU minute/day comparison windows with
  exact-boundary, future-time, signed integer, and invalid-operand controls.
- Resolve reference metadata before traversal/actions, even in an unreachable
  expression; compare strictly newer, respecting existing `-P`/`-L` policy.
- Deletion is a Boolean action, implies postorder, and suppresses implicit print.
  Failures are false and set failure status; Boolean short-circuiting remains.
- Use nonrecursive file/link removal and strong empty-only `rmdir`; never
  approximate directory removal with recursive deletion. Respect actual-path
  capabilities, readonly filesystems, unsupported/snapshot-only removal, signals,
  depth/directory-entry limits, and preserve already-completed effects on abort.
- Reject `-prune` with `-delete` unless `-depth` was explicitly supplied.
- Preserve existing unsupported features and byte/literal `-exec` arguments.

## Evidence

- Prior read-only validation reproduced all four missing primaries: exit 2,
  `find: unsupported expression '<primary>'`, before filesystem access.
- Native GNU findutils 4.7.0, September 5, 2026, on an absent pathname:
  `find /__poe_find_638_nonexistent__ -prune -delete` reports that `-delete`
  implies `-depth` and requires explicit `-depth` with `-prune`.
  Adding `-depth` proceeds to the expected nonexistent-path error. Neither
  control creates or deletes files.
- RED: `TSX_DISABLE_CACHE=1 timeout 60s node --max-old-space-size=256 --import tsx
  packages/safe-bash/tests/commands/find-time-delete.test.ts`:
  67 tests, 0 pass, 67 fail, 0 cancelled/skipped; exit 1 (59.811374 ms reported).
  Representative failures: supported time predicates returned 2 instead of 0;
  deletion returned 2 instead of success; reference failure returned 2 instead
  of filesystem error status 1. Integer validation controls saw unsupported
  `-delete`/time expressions rather than the required argument diagnostics.
- The initial isolated `node --test` launch returned a file-level failure with
  no individual diagnostics. The direct node:test invocation above exercised
  all 67 controls; this initial launcher result is not semantic RED evidence.
- GREEN and scoped gate results are recorded below. Guarded lint is deferred
  to root; no maintained owned-file lint route was used or bypassed.
- First implementation run: 67 tests, 66 pass, 1 fail. The clock-call-count
  assertion also counted helper setup; replace it with a clock that advances
  during traversal, testing stable selection instead of helper internals.
- Additional native GNU 4.7.0 oracle uses `os.memfd_create`, `os.utime(fd, ...)`
  and `find -L /proc/self/fd/FD`, with inherited descriptors and no disk files.
  At 30 seconds old, `-mmin 0` produces no output, `-mmin 1` and `-mmin +0`
  produce `match`, `-mmin +1` does not. At 90 seconds, `-mmin +1` matches.
  At half a day, `-mtime 0` matches and `-mtime +0` does not. At 1.5 days,
  `-mtime 1` and `-mtime +0` match, while `-mtime +1` does not.
  Thus the original common floor-bucket minute assertions were mistaken,
  not product acceptance; retain the initial RED/first-run counts above.
  GNU `find/parser.c` (`do_parse_xmin`, `parse_time`) and `find/pred.c`
  (`pred_timewindow`) further establish strict signed comparisons, the
  minute equality window, and the one-second adjustment for negative day
  comparisons. Updated tests precede the comparison correction.
- Corrected-comparison RED: 70 tests, 57 pass, 13 fail (exit 1;
  432.561994 ms), including minute windows, signed day boundaries, overflow,
  stable invocation time, and followed-link minute selection.

## Final focused results

All commands ran uncached (`TSX_DISABLE_CACHE=1`) with a 60-second outer
timeout, 256 MiB Node old-space, and repository-local hook variables cleared
in the command subshell using `git rev-parse --local-env-vars`. Unit fixtures
and mutation controls use MemoryFileSystem only; no host fixture files,
captures, caches, builds, or dist outputs were written.

- First corrected implementation GREEN: 70/70, exit 0, 393.469959 ms.
- Added six passing composition/reference/output-limit/unsupported-syntax
  controls without further product changes. Final new file: 76/76, exit 0,
  402.56154 ms, zero failed/cancelled/skipped tests.
- New plus adjacent selection: 83/83, exit 0, 600.672202 ms,
  zero failed/cancelled/skipped tests. This is 76 new and 7 selected adjacent
  cases, not acceptance of tests filtered out by the name selection.
- Native boundary follow-up: `-mtime -0` matches age 0.5 s, not 1.5 s;
  `-mtime -1` matches 86400.5 s, not 86401.5 s; `-mtime +1` matches
  172800.5 s, not 172799.5 s. `-mmin 1` matches 59.5 s, not 60.5 s;
  `-mmin +1` matches 60.5 s, not 59.5 s. All native commands exited 0
  with empty stderr. Exact thresholds are separately fixed-clock unit cases.
- Read-only `git diff --check` on the owned tracked source diff exited 0.
- No lint, full build/typecheck, full suite, source registration edits, Git
  writes, commits, branches, push, or release work. Concurrent disjoint edits
  were present and left untouched. Root owns registration and maintained gates.

New-file command, after the environment preparation above:

```sh
TSX_DISABLE_CACHE=1 timeout 60s node --max-old-space-size=256 --import tsx \
  --test --experimental-test-isolation=none --test-concurrency=1 \
  --test-reporter=tap packages/safe-bash/tests/commands/find-time-delete.test.ts
```

Adjacent-selection command:

```sh
TSX_DISABLE_CACHE=1 timeout 60s node --max-old-space-size=256 --import tsx \
  --test --experimental-test-isolation=none --test-concurrency=1 \
  --test-reporter=tap \
  --test-name-pattern='find|directory admission preserves lexical order' \
  packages/safe-bash/tests/commands/find-time-delete.test.ts \
  packages/safe-bash/tests/commands/execution.test.ts \
  packages/safe-bash/tests/commands/directory-admission.test.ts
```

The explicit no-isolation profile avoids the initial opaque file-level launch
failure; it does not qualify the default isolated runner or root maintained gate.
The plan is evidence of focused live-worktree execution, not a frozen-tree seal.

Final SHA-256 observations (owned files only):

| Path | SHA-256 |
| --- | --- |
| `packages/safe-bash/src/commands/find.ts` | `dfb3658caae8f31ad70eb6c75528388d4995f9a42776549b53ffde44ba6b33bb` |
| `packages/safe-bash/tests/commands/find-time-delete.test.ts` | `e79216a056d184473123cf3ca44d5588fc2d3149e8eef75fd24342891c52614c` |
| `packages/safe-bash/src/contracts/find-time-delete.md` | `655016b00e442768032f2d69815b81104cf9f0f4e506d293f3b8143ed7c95179` |
