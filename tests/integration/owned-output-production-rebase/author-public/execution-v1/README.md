# Released author execution v1

ROOT authorizes candidate `eba049535d154f4e028f57ffd8efd7622b2239ca`, tree
`62d75ef09e89d4d3b6afc032c518d2846dcd03b7`, on August 27, 2026. The 247-source
manifest is SHA-256 `d61b88557d04647f487af0d4483124d28159dbc98c26ccc8b868de5777978a95`.
Preparation commit `e748f20f` remains byte-for-byte unchanged. This version adds
bindings only; the prepared public runtime and strict fixtures remain unchanged.

The full committed archive contains 32,317 paths, including 12 existing native
oracle fixture symlinks. `CANDIDATE.json` binds their exact Git blobs/targets.
They are preserved as native data, never traversed by integrity snapshots, never
copied into the product package, and never used as canonical typecheck exclusions.
Unknown links remain errors. Complete source/test/tool trees and new directory
entries are checked, not only the original tracked filenames.

The archive exceeds the preparation driver's 512 MiB command-capture buffer, so
the new driver streams `git archive` to regular TMP. All committed inputs are
included. The unchanged maintained target's `git ls-files` uses an isolated TMP
index populated with this candidate, the public repository's read-only object
store, explicit `GIT_WORK_TREE`, disabled fsmonitor and optional locks. This is
not a new Git worktree or a mutable HEAD fallback. The temporary index is hashed
before and after. No root index, configuration, source or `dist` is modified.

`EXECUTION-INPUTS.json` and its Git commit authenticate these execution inputs
before runtime. Output is unique regular TMP, separate from inputs. This release
does not authorize material fixture/assertion/API/private-policy changes. First
attempts, failures and exact foreign typecheck diagnostics must remain visible.

Actual private cohorts require their own current compiled import/driver binding,
fresh before/after private guards, and unchanged approved 25 semantic profiles.
They are not implied by successful public build/package checks. No independent
acceptance, release promotion, full gate, parity or superiority claim is made.
