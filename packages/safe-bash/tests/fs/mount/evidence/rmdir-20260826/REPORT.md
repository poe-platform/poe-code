# Safe directory-only removal checkpoint

## Scope and contract

Curie added `FileSystem.rmdir?(path: string, options?: FsOptions): Promise<void>`
in contract commit `1dc0652`. This leaf changed only memory, real, readonly,
mount and overlay source/documentation and their matching tests. It did not
change contracts, core commands, patch consumers, S3/WebDAV, root exports,
shared conformance, or independent review tests. Existing `rm` implementations
and options are unchanged. Two readonly test calls now use the approved
`FsOptions` shape instead of the former convenience method's recursive option;
their EROFS expectations are unchanged.

## Implemented semantics

- Memory checks the actual directory node and deletes its parent entry without
  yielding between empty-check and deletion. It calls neither `readdir` nor
  `rm`. Files and final symlinks are rejected; existing descendants survive.
- Real uses native `rmdir` only, never `rm` or recursive flags. A deterministic
  native-boundary hook inserts a child immediately before removal and observes
  ENOTEMPTY with the child preserved. Another hook replaces the directory with
  a symlink and observes ENOTDIR with the target's child preserved. Existing
  pathname/ancestor race limitations are not claimed to disappear.
- Readonly always returns EROFS, before options/path/delegate inspection,
  preserving its established readonly precedence even for aborted signals.
- Mount routes to the selected backend's optional `rmdir`, including nested
  mounts. It retains protected roots/ancestors, readonly checks, public error
  paths and signal forwarding. Missing support returns ENOTSUP with no fallback.
  A child inserted at the delegation boundary survives the backend's ENOTEMPTY.
- Overlay checks the merged view, rejects visible descendants with ENOTEMPTY,
  and uses upper `rmdir` only when its lower contribution is already isolated
  by opaque/whiteout state. It then retains the whiteout without deleting lower
  storage. It performs no staged rename, recursive backing removal, or pending
  garbage cleanup during this operation. Upper errors propagate unchanged in
  meaning with the original public path/syscall; no whiteout is published on
  an upper rejection.

Empty lower-only or unisolated merged directories return ENOTSUP, not a fake
successful removal. Even a currently absent lower counterpart can acquire new
children before upper deletion; a readonly handle does not freeze other handles.
The current contract cannot atomically couple a live lower empty-check to a
whiteout without lower mutation. Deterministic stale-listing tests insert lower
children and prove they remain visible after refusal. This provider/composition
limit is explicit, not waived conformance. Directories created through the
overlay are opaque and retain supported directory-only removal. Delete/recreate
tests preserve the underlying lower bytes and keep them hidden in the overlay.

Cancellation is checked and forwarded; pre-aborted operations leave their
directories intact (readonly retains EROFS precedence). As with existing native
operations, cancellation after a completed host effect is not rollback.

## Validation and unchanged RED identity cohort

`manifest.json` records exact commands, entrypoint lists, test/source hashes,
exit statuses, counts and output hashes. All filesystem/contracts source hashes
were stable during these runs. The later overlay README heading-only formatting
adjustment does not change any tested TypeScript. No unrelated global build or
command/shell test gate is represented by these scoped results.

| Cohort | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| New rmdir tests, five owned implementations | 50 | 0 | 50 |
| Other existing owned tests (excluding identity files) | 521 | 0 | 521 |
| Original unchanged mount identity reproduction | 1 | 3 | 4 |
| New required identity guards from prior checkpoint | 11 | 38 | 49 |
| Complete owned suites, all cohorts included | 583 | 41 | 624 |
| Unchanged shared conformance | 202 | 0 | 202 |

Strict scoped TypeScript `--noEmit` passes. Every test run has zero cancellations,
skips, and TODOs. The complete owned suite still exits 1; this report does not
exclude required failures from its denominator.

The previous **533/574** checkpoint consists of **521/521 other existing tests**,
**1/4 original reproduction**, and **11/49 newly added identity guards**. Its 41
failures are **three existing source-truncation bugs plus 38 new required-RED
guards**, not 41 new rmdir regressions. This checkpoint adds 50 passing rmdir
tests and introduces no additional failures in the existing owned cohort.

## Identity remains blocked, not accepted

The inspected contract contains no Curie-approved identity seam. It still has
only unscoped optional `dev`/`ino`, which cannot distinguish overlapping real
instances through wrappers from unrelated synthetic collisions. The original
three alias failures still lose source bytes; the 38 added guard failures remain
requirements, not successful characterizations or accepted limitations.

Per the explicit instruction, this leaf did not wait for or invent a contract
field, did not change any identity expectation, and kept the original immutable
reports/artifacts under `../identity-20260826/` untouched. The exact identity
proposal and remaining owner dependency remain in
`/tmp/safe-bash-mount-identity-contract-needed.txt`. Cross-instance identity closure
needs a separate approved seam and a separate atomic implementation/review commit.
