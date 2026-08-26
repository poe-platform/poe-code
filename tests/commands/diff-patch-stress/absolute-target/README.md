# Independent explicit-target priority verification

## Result — August 26, 2026

No product defect found in this assignment. **30/30 tests pass, zero skipped**:
27 independent Shell/plugin vectors, one exact existing benchmark integration
test, and two bounded live GNU patch 2.8 observations. Strict scoped TypeScript
checking passes. The first run had two verifier-only failures from incorrectly
assuming mode `0644` for newly created MemoryFileSystem files; its established
default is `0666`. Correcting that assumption did not change product code.

The priority authorization fix is committed as
`e685231032b34f06c34038ce4c443376af7e066d`. Final tests include the subsequent
format-parser commit `b7f2bfffc1fe4d50fac0352fdcc19eac6225359d`, rather than
claiming that only the earlier uncommitted implementation was verified.
`patch-path.ts` matches the authorization commit; `patch.ts` matches the later
committed blob. Both were clean and unchanged before/after final verification.

## Coverage and boundaries

All product execution uses the actual Shell and `diffPatchCommands()` plugin
against MemoryFileSystem, never a host process. The independently constructed
vectors check absolute targets inside and outside cwd, relative targets overriding
absolute headers, ignored symlink header paths, and `-p999` not stripping explicit
targets. They reject absolute headers without a target, including an absolute
new header with `-p1`; validate traversal before stripping/normalization and
quoted control metadata even with authorization; and reject final/ancestor/
dangling target symlinks, hardlinks, and symlink patch input. Absolute virtual
`-i`, dry-run, reverse, creation, deletion, and reverse creation/deletion are
covered. Each vector compares the entire VFS namespace, byte contents, modes,
link counts, and symlink destinations, not merely the selected target.

The exact `plugin-diff-patch-roundtrip` fixture is imported read-only from
`pluginFixtures()` and executed through the existing `EngineSession`, using:

```sh
diff -u --label old --label new old new > change; patch /fixture/old < change; cat old
```

Virtual-bash passes all four existing assertions: stdout bytes, stderr bytes,
exit code, and complete regular-file snapshot. Just-bash 3.4.2 fails stdout,
stderr, and filesystem assertions; exit code passes because the final `cat`
succeeds. Its observation is reported independently, not counted as a virtual
product regression or asserted to pass by this verifier's test.

## Existing full comparison

The unchanged existing runner completed all 118 workloads with no filters:
virtual-bash **118 pass / 118**; just-bash 3.4.2 **108 pass, 9 fail, 1 unsupported
/ 118**. Runner overall status remains `fail` and its exit status is nonzero
because comparator non-passes are retained. The denominator includes 88 Bash
oracle fixtures, 18 deterministic cases, 7 plugin cases, 2 pinned GNU sed policy
cases, and 3 probes. This is the selected-policy benchmark, not a rerun or
replacement of the unmodified live-native GNU/BSD matrix.

The run started `2026-08-26T20:47:46.531Z` and completed
`2026-08-26T20:47:47.100Z`. Recorded HEAD before/after was
`2340844163cce1b2528e7c0165575165c00e9638`. Source and harness fingerprints stayed
identical and no background errors occurred. Other workers had uncommitted
source edits: **this is a stable worktree result, not a clean-checkout result for
that HEAD**. Full JSON is `/tmp/safe-bash-absolute-target-comparison.json`;
`evidence.json` preserves its hash, provenance, denominator, summary, exact-case
assertions, and every non-pass name.

Initial inspected `patch.ts` SHA-256 was
`3ef569a8473e9fea6b097f4cb8376d66f8da7214f06f7480c010b64093df4b32`.
Final verified before/after SHA-256 was
`a4149cf2c27c4edaab9e79a8a703353a15853a0615983296a1ca26c260e1b7ee`.
`patch-path.ts` remained
`f4a115ab2dbd3bba8e6ac383ca6dcea46a6cc6fa6ed9a14fc206ab763a6bf35b`.
The transition reflects concurrent source-author work, not verifier edits.

## Native evidence and reproduction

Official GNU documentation consulted for explicit input-file selection and
header stripping, not as an excuse to select unsafe metadata over an explicit
target:

- `https://www.gnu.org/software/diffutils/manual/html_node/Invoking-patch.html`
- `https://www.gnu.org/software/diffutils/manual/html_node/patch-Directories.html`
- `https://lists.gnu.org/archive/html/info-gnu/2025-03/msg00014.html`

The independently invoked GNU patch reports version 2.8; executable SHA-256 is
`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
Both native cases use literal argv, `--batch --no-backup-if-mismatch -p999`, a
three-second deadline, 64 KiB output limit, and disposable owned-directory
fixtures. All native target and absolute-header paths are inside those fixtures;
none targets host `/fixture` or `/authorized`. The relative explicit target wins
over two existing absolute header paths; the absolute target outside cwd also
wins despite excessive stripping. Complete native file snapshots match, with
no backups or rejects. Actual argv, input, output, binary hash, and snapshots
are preserved in `evidence.json`. Temporary fixture paths in that evidence no
longer exist because cleanup succeeded.

```sh
SAFE_BASH_GNU_PATCH=/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch \
  node --unhandled-rejections=strict --import tsx --test \
  tests/commands/diff-patch-stress/absolute-target/*.test.ts
node_modules/.bin/tsc --noEmit \
  -p tests/commands/diff-patch-stress/absolute-target/tsconfig.json
npm run benchmark -- --output /tmp/safe-bash-absolute-target-comparison.json
```

Without `SAFE_BASH_GNU_PATCH`, only the two native tests skip; such a run is not
30/30 live verification. No runtime dependencies were added. Only new files
under this directory are owned/modified; product, benchmarks, and source-author
tests remain read-only.

Residual gaps: no broad format/path, race, alternate-filesystem, or full-shell
claim; those belong to separate assignments. This selected corpus does not
establish the requested broad superiority over just-bash, universal utility
compatibility, project completion, or 72 hours of work.
