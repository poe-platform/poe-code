# Snapshot-marker wrapper author checkpoint

August 27, 2026. Implements the wrapper portion of the root-authorized
`snapshotRmdir` contract/handoff from `ba200fe`. This is source-author evidence,
not the different-agent verification requested for the next checkpoint.

## Stable behavior

- Mount exposes `snapshotRmdir` as a live getter on its frozen capabilities
  object. Any routed backend declaring true makes the aggregate true. Nested
  mount flattening preserves the declaration. A retained capabilities object
  also observes a host facade that adds/replaces a snapshot-profile route after
  construction; the actual MountFileSystem API has no dynamic mount/unmount
  method. Strict routes still use their existing strict operations. Snapshot
  success is forwarded without hiding a late child or claiming directory absence.
- Overlay refuses `rmdir` with `ENOTSUP` when the upper currently declares the
  snapshot profile. The check follows ordinary path/permission/emptiness checks
  and cancellation, but precedes any delegated removal, whiteout, or link-state
  change. Existing no-garbage-cleanup rmdir behavior is retained. Lower-only
  whiteout removal and mixed-profile mounted uppers are conservatively refused
  too; no per-path proof exists to safely narrow that case. Other mutation
  capabilities are not weakened. Strict uppers still work above static lowers,
  even when the lower advertises snapshot-marker support. Exclusive-upper and
  static-lower prerequisites are unchanged.
- Readonly source is unchanged. It never delegates removal, omits the weaker
  profile, and retains `EROFS` precedence over options access, invalid paths,
  and pre-aborted reasons. An outer mount still checks its own cancellation
  before routing, so it can return the exact abort reason instead.

Production implementation change: one getter line in `src/fs/mount/index.ts`
and a three-line refusal in `src/fs/overlay/index.ts`. No memory, real,
contracts, commands, exports, S3 or WebDAV implementation is edited. Existing
test expectations are unchanged; no old report is rebaselined.

## Frozen checks

The committed base is `4e2d71c6120078dd9b76e1511804fbca13e4dd2b`. The runner
archives that base's source and exact existing test/helper inputs, then adds
the three new owned regression files. It records the red new-test cohort before
applying only the two owned implementation overrides. All named input bytes
are checked unchanged around each command; generated build files are hashed
separately. Updated prose is not part of the implementation-override cohort.

| Separate cohort | Observed result |
| --- | --- |
| New tests on unchanged base source | 9/16, seven reproduced failures |
| Same new tests with wrapper source change | 16/16 |
| Original required alias guards | 49/49 |
| Original separate alias reproductions | 4/4 |
| Existing wrapper rmdir tests | 36/36 |
| All 22 existing top-level mount/overlay/readonly test files | 496/496 |
| Scoped strict types, existing and new wrapper test entrypoints | exit 0 |
| Archived-source build | exit 0 |

Every test cohort has zero cancellations, skips and TODOs. The 49, four and 36
are included in 496; do not sum overlapping counts. The new16 are separate.
This is not a repository-wide gate. No independent authority-trust-review tests
were modified or staged. No provider service or download was duplicated.

The new controls cover flattened and dynamically replaced routed profiles,
strict-route nonempty/root guards, real Shell plus actual `agentCommands()` for
`rmdir` and `rm -d`, exact signal/error forwarding, readonly precedence, upper
late-child/nested-directory visibility, prior whiteout preservation, lower-only
refusal without copy-up, file/missing/root/provider errors, profile changes during
inspection, and strict-upper positive controls. Snapshot-capable delegates here
are deterministic host facades over memory. Their modeled late-child success
tests the wrapper boundary, not real S3 marker deletion or deployed providers.

## Provenance and replay

Successful capture command:

```sh
node tests/integration/adapter-tools/remote-rmdir/wrapper-profile/verify.mjs author-verified 4e2d71c6120078dd9b76e1511804fbca13e4dd2b
```

Use a new cohort name to rerun; the runner refuses to overwrite evidence. Exact
argv, temporary working directories, times, statuses and hashes are recorded
in `author-verified/*.json`, with unmodified raw stdout/stderr beside them.
The archive and `overrides/` bytes permit replay of these precise inputs without
the moving worktree. Local Node/development dependencies are reused, not
installed or fully archived. Node is v22.22.2. Temporary build and native test
roots are contained in the runner's own snapshot via `TMPDIR`; only that owned
snapshot is removed. Other owners' source changes are excluded.

- Frozen base source manifest SHA-256:
  `f5d0aea6cca5f835a0ae07633f2d71a9a48757c24f50be9e4d7eae7957996702`.
- Frozen candidate source manifest SHA-256:
  `940e098a8c3df26f01bfa2b6cb020a766b1039527975ac5fd1686a168aaa1399`.
- Verified candidate source/test/helper input manifest SHA-256:
  `127a59cfd8a23d163090d92a3a588ff998e772aeb4b6cfd77775f387c945133b`.
- Mount implementation SHA-256:
  `a2be203c4bb0a1c979e9ff2ab3672f7aa7a1f441cc4c57cddcca7e4807a1881d`.
- Overlay implementation SHA-256:
  `e14936876292b4900e1f2d4298ae5ec41509c5772d5afc63bf143d36c85662be`.
- Unchanged readonly implementation SHA-256:
  `384f940196dc572f677541daa9c420da2e013324d66576004c1a2730e7899067`.

Manifest fingerprints use SHA-256 of `JSON.stringify(entries)` in recorded
order; source fingerprints filter paths starting with `src/` first.

Two setup incidents remain immutable beside the successful capture:
`author-first` incorrectly grouped the four alias reproductions with the 49
guards, observed 53/53, and stopped on its denominator assertion. `author-final`
corrected that grouping but omitted the existing real-fixture helper imported
by identity-scope tests, observed 487 pass plus one module-load failure, and
stopped before types/build. `author-verified` includes that exact committed
helper; no helper or test assertion was changed. These earlier captures are
not product failures or successful complete gates. Their source hashes match;
the additional helper explains the final all-input hash difference.

## Root handoff

Commit the wrapper implementation and this evidence as the bounded author
checkpoint; a different agent should verify it independently. Once root relays
the ready S3 implementation and final combined source commit, resume original79
from explicit archives with unchanged original matrix assertions, preserving
the `debb29e` observed77/79 baseline from `9ba94f5`. Record any S3 MockS3Client or
WebDAV helper changes separately, not as unchanged-all-input evidence. The old
matrix was not rerun in this wrapper task. Actual S3 service evidence remains
the S3 author's work; WebDAV design/support is not accepted by this checkpoint.
