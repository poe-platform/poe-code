# One current-dependency replay

**Recorded stable runtime snapshot, not blanket current-tree/global acceptance.**
One replay ran on August 27, 2026, 00:21:55–00:22:20 UTC. Starting and ending
HEAD: `7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3`. Shell source remains
`21a6b9149e3a0e35e14f1c740860971f08053686`; cohort `c440c1a` is unchanged.
All prior `post-ready-*.json`, including the failed final seal in `5604e8b`,
remain byte-identical and retain their original status.

| Freshly executed cohort | Result |
| --- | --- |
| Independent 57+15 holdouts | **69/72**, three known failures |
| Unmodified author invocation tests | **130/132**, two known failures |
| Prior file-entrypoint tests | **58/58** |
| Selected targeted regressions | **121/121** |
| Fresh raw own 5.3 / 3.2 comparisons | **48/57 / 46/57** |
| Fresh raw author 5.3 / 3.2 comparisons | **98/104 / 82/104** |
| Build noEmit | Exit 0; input guard stable |
| Global noEmit | Initial exit 2; corrected exit 0 **not guard-certified**, below |

No runtime skips, xfails, TODOs, cancellation, deadline or capture overflow.
No new in-scope product defect was observed. Independent losses remain broader
POSIX special-assignment semantics and absent `command -v`/`type`; author losses
remain unsupported `read -N`. Strict file policies and raw diagnostic dialect
differences remain in every raw denominator. Neither selected semantics nor
known limits are relabeled as universal Bash compatibility.

## Exact source and dependency snapshot

The known authorized `37e19b7` cp change is included, but the starting tree also
contained uncommitted filesystem-command/move work; it is not a clean-HEAD test.
Current starting hashes, not historical `21a6b91` hashes, guard dependencies:

| Dependency | Replay SHA-256 |
| --- | --- |
| `src/shell/runtime.ts` | `6a86339d76e764031a26671586842467a40dc989895589ab416306e655496145` |
| `src/commands/filesystem.ts` | `63e16e4990c19cbf2db23f3820cffd7b3931ea43dd4879706bd9c846f1695e9c` |
| `src/commands/move.ts` | `9766704dc9a65d27c397852db76f5f78baaad8b1db4f1163c428464596662b2c` |

All **37 actually imported source dependencies** have exact per-phase before/
after hashes and `.ts` load-hook evidence in `refreshed-*.json`; the full shell
hash set is in `refreshed-start.json`, and all dependency hashes are together in
`refreshed-summary.json`. No relevant dependency changed during any runtime run.
All 37 also matched at replay completion. At the later final observation,
`move.ts` differed: `8e8dcde6f50b4715d78a7a21cc8a931314271e5e099ba8b290fd8834c04a4918`.
`refreshed-final-state.json` records this end-tree drift separately; it does not
retroactively invalidate stable runs or certify the changed tree. No rerun followed.

## Typecheck limitation and correction

Initial global compilation failed only on verifier-created TS7034/TS7005 in
`refresh.ts` (an unannotated results array), not the other leaf's TS2345 issue.
The exact failed run is immutable in `refreshed-global-types.json`. An explicit
`RefreshRecord[]` annotation fixes that owned mistake without changing tests.
One **type-only** correction check followed; no runtime/native cohort repeated.
Global compiler exit was 0, but `tests/stress/adapters/s3-permission-profile/probe.ts`
was newly present in its compiler file list and lacked a starting hash in that
correction baseline. Its recorded `before: null` means **incomplete guard proof**,
not proven during-run mutation. Therefore no guarded global pass is claimed.
Build compilation again exited 0 with a stable guard. Both outcomes are in
`refreshed-type-correction.json`. There were no further retries or foreign edits.

## Fresh bytes, reproduction and cleanup

The fixed raw helper now accepts an optional third argument selecting the fresh
capture. `refreshed-raw-comparison.json` references the new 72-row virtual capture
SHA-256 `6919f60bfb438b0bb417f23a89af357ed90d59d6ba2165ddac6d43a075059caa`,
not old virtual results; it separately runs 104 fresh author virtual observations.
All pinned native snapshots remain unchanged. No new invocation-native, first-read,
NUL, remote-audit or full-suite probes ran. The unchanged descriptor regression
ran its existing **17 `/bin/bash` 3.2 references**; modern role-rendered child
provenance and the author's `/bin/bash`-child limitation remain as documented.
Dirac's historical nine-native/five-custom mapping is not included in these totals.

Exact commands, byte captures, statuses, imported hashes and observed HEADs are
in the phase JSON. A deliberate future single replay with fresh evidence names:
`node --import tsx tests/shell-stress/invocation-modes/refresh.ts another-prefix`.
Evidence cannot be overwritten. All **81 recorded process groups** are absent,
no temporary refresh directory or watcher remains, and foreign staging is preserved.
