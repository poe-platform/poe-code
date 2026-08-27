# Independent GNU strings argv0 binding review

## Result and scope

PASS for the requested bounded review of candidate
`8784a8fc0484313b914fe1ae6db33a8cfd0e0be4`. This verifier did not author
the candidate and did not execute or reuse the author's verification script/tests.
The author handoff identified the immutable candidate and existing native prerequisite;
the results here come from this independent execution.

Run: `run-2026-08-27T15-53-35-228Z/`, August 27, 2026,
15:53:35.228–15:53:37.752 UTC (10:53:35.228–10:53:37.752 America/Chicago).
The measured driver run lasted 2.524 seconds; this is not total development time.

- Untouched original `gnu-strings.test.ts`: **14/14 tests pass**, including
  all 13 original fixtures and its live, strict 13-observation native comparison.
  No failures, skips, cancellations, or TODOs.
- Independent controls: **10/10 pass**, no failures/skips; these supplement,
  rather than replace, the original corpus.
- Additional namespace append-detection control: **1/1 pass**.
- **38 actual native invocations**: 14 in the original cohort, 24 in controls.
  All used the authenticated staged executable, including version probes.
- All **1,564 original lone-dash golden stderr bytes** match exactly under the
  logical argv0 binding. The original golden JSON is unchanged from both the
  candidate's parent and its original commit
  `4af1b107d4b9449a2c4e7fed467d187448392fd5`.

Frozen8670 remains unqualified. This is not a fullgate, whole-repository acceptance,
superiority, GNU/Linux parity, service acceptance, or 72-hour-work claim.

## What actually ran

The driver exported only committed `src`, `tests/commands/stream-inspection`, and
`package.json` from the pinned candidate. It authenticated all **252 files** against
their Git blob IDs and executable modes, with no live source overlay. It then added
an explicitly recorded link to existing development `node_modules` and copied the
already provisioned GNU strings binary; nothing was downloaded, built, or installed.

The complete extraction and staged native binary were physically renamed from
`/tmp/strings-binding-independent-OjIjtP/initial-location` to
`/tmp/strings-binding-independent-OjIjtP/moved committed workspace` **before**
execution. The original extraction location no longer existed. Spaces in the moved
path were retained. The actual executable was:

```text
/tmp/strings-binding-independent-OjIjtP/moved committed workspace/native-bin/strings
```

Its resolved identity was:

```text
/private/tmp/strings-binding-independent-OjIjtP/moved committed workspace/native-bin/strings
```

The logical argv0 used by the aggregate helper remained:

```text
/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings
```

The original logical-path binary was read and hashed, **never executed as a
fallback**. The audit rejected any native executable selection other than the
staged copy and forwarded the original Node `spawnSync`, without replacing native
results or changing any candidate source. Both explicit `identity()` and aggregate
`captureGnuStrings().identity` retain staged executable/resolved/hash values.

The canonical run used `STREAM_NATIVE_LIVE=1`, the staged `STREAM_GNU_STRINGS`,
and `TSX_DISABLE_CACHE=1`. Exact subprocess argument arrays, working directories,
and explicit environment overrides are in `commands.json`. The original helper's
module-relative scratch existed only inside the isolated extraction.

## Independent controls

1. Bound real native lone-dash execution strictly equals the entire original
   observation, including all 1,564 stderr bytes.
2. Explicit wrong argv0 equal to the staged executable reproduces the original
   strict `deepStrictEqual` failure (`ERR_ASSERTION`). All non-stderr observation
   fields still equal the golden. This run's wrong-prefix stderr is 1,578 bytes;
   its unmodified bytes and the actual assertion diagnostic are retained.
3. Omitting `capture`'s argv0 parameter yields exactly that executable-default
   observation, including stderr. It also equals a real direct `spawnSync` with
   **no argv0 option**, not a default rewritten to the logical fixture path.
4. A nonexistent logical argv0 produces that path in real GNU usage output while
   executing the staged native binary. The logical pathname remains nonexistent.
5. The original positive filename-label fixture retains exact `data:` labels,
   offsets, tab bytes, option arguments, and exclusion of supplied stdin.
6. Original dash/file operands retain their order and exclude the `LEAK` stdin.
7. Original stdin labels and octal offsets match exactly.
8. Additional literal filenames containing spaces and a leading dash retain their
   positive labels, argument boundaries, bytes, and offsets; stdin remains excluded.
9. Explicit identity reports the staged executable, resolved path, and native hash.
10. Aggregate identity stays staged and all 13 original native observations match
    by strict deep equality again.

The audit records actual args, argv0 presence/value, input bytes, return status,
signal, output hashes, native identity before/after each call, and fixture-directory
entries/content hashes before/after. Every native file-input operation left its
input namespace and bytes unchanged. Each control also checks that original
fixture objects and the complete extracted tree are unchanged after helper cleanup.

## Authentication and cleanup

SHA-256 values, identical before/after where applicable:

| Input | SHA-256 |
| --- | --- |
| Candidate commit content | `2fceab6fde47a7ebfb0a01fb0bea4e1bc9791eea9536bcd464ef4fe158e43f8c` |
| Selected committed tar archive | `6350569613954bafabef4bb57afe3d7c87d406c20288536649ff0d4ed4b29df1` |
| `oracle.ts` | `7e6b128a0f52c42f45ac3b43edbda9b7bed71671d0fc584069bb692ebb8e35c5` |
| `gnu-strings-oracle.ts` | `3bca0a375335f55d1fd5145362c88ba7ad5912db0109c76f14b0e03f3cd9c2c0` |
| Original `gnu-strings.test.ts` | `5c580bc131e382565c7dd2b84da5368813749b9e1526590fc0853ef8af9a8d57` |
| Original `gnu-strings-cases.ts` | `8b9a59f45b3e075db07a4f5073bcf516eb99ee8f29be7e695d92d48f5df79eca` |
| Original `gnu-strings.json` | `e00ba3920f79dcb4ef58d0a19242e07d1de6bd1698c66c56c0a27bb5eabb1d72` |
| All original lone-dash stderr bytes | `408835816cfd774536a0bffae5ade7814e96e2e8e4091618b47bb5edfd796705` |
| Native original and staged copy | `90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f` |
| Full moved namespace manifest | `6a8aa50cb101b8070c47ede3d893a02eaef1bac4be1fa1556dc25fb7c76c1c22` |
| Existing development-tool namespace | `cb9f687fd71d625c6dfb5b2ab5424a8d8326b532ce0daec5aaf79c2813ba67a2` |
| Executed independent driver | `894f4dcb2a047b310ca03bca7be2d9ff195b2fda0049161f275b280ff26e6575` |

Full per-file source hashes and Git blob identities are retained in manifests.
Post-run archive bytes were also compared with a fresh export of the same immutable
commit. Namespace enumeration checks **all entries**, including additions, removals,
directories, modes, and symlink targets; it does not merely rehash original paths.
A separate append probe demonstrated detection of a newly added `.data` entry.
The `node_modules` symlink is not followed by the candidate scan; its existing target
namespace is independently hashed before and after.

All audited native/Node PIDs and detached invocation groups were absent at cleanup.
No forced group cleanup was needed. All helper scratch, the append probe, staged
native copy, extraction, audit scratch, and temporary archive were removed. The
original native prerequisite and foreign live fixtures remain untouched.

The live checkout was dirty and had advanced to
`0ec75ef320ecaea9fc66e1ba952f3961c917685c` when the driver ran; its exact before/after
status and index are recorded. The initial inspection found an empty index; other
workers subsequently staged their own files. The driver did not stage, unstage,
commit, or alter those paths. Unrelated live work neither entered nor vetoed this
explicitly pinned committed extraction.

## Reproduction and evidence inventory

From `/Users/kjopek/Workspace/safe-bash`, with the existing native prerequisite and
Node v22.22.2 / tsx 4.23.12 available:

```sh
node --check tests/commands/stream-inspection-stress/argv0-binding-review/verify.mjs
node tests/commands/stream-inspection-stress/argv0-binding-review/verify.mjs
```

Each run creates a fresh timestamped evidence directory via `apply_patch`, never
overwriting a prior capture. The script needs the already available `apply_patch`,
Git, `/usr/bin/tar`, and `/usr/bin/sw_vers`. Tested host: Darwin arm64, macOS 26.4.1
build 25E253; Git 2.50.1 (Apple Git-155), bsdtar 3.5.3. Native profile is GNU Binutils
2.44, `--enable-default-strings-all --with-system-zlib`, not GNU/Linux.

Owned files:

- `verify.mjs`: self-contained driver, forwarding native-call audit, independent controls.
- `README.md`: this bounded independent conclusion and reproduction instructions.
- `SEAL.json`: delivered evidence paths, sizes, and hashes; excludes itself.
- `run-2026-08-27T15-53-35-228Z/report.json`: counts, hashes, host, live/frozen distinction, cleanup, limitations.
- `run-2026-08-27T15-53-35-228Z/commands.json`: exact child commands and explicit environment overrides.
- `run-2026-08-27T15-53-35-228Z/original-cohort.tap`: original test runner output.
- `run-2026-08-27T15-53-35-228Z/controls.json`: independent results and raw diagnostic/output hex.
- `run-2026-08-27T15-53-35-228Z/original-cohort-native-audit.json`: original native cohort execution audit.
- `run-2026-08-27T15-53-35-228Z/all-native-audit.json`: all original/control native execution audits.
- `run-2026-08-27T15-53-35-228Z/git-inputs.json`: committed input paths and blob identities.
- `run-2026-08-27T15-53-35-228Z/committed-source-manifest.json`: extracted committed file hashes/modes.
- `run-2026-08-27T15-53-35-228Z/namespace-before.json`: full pre-run moved namespace.
- `run-2026-08-27T15-53-35-228Z/namespace-after.json`: full post-run moved namespace.

The executable verifier is `.mjs`; captured bytes, fixture inputs, and diagnostics
are JSON/TAP data, not TypeScript source or `.test.ts` discovery inputs. No discovery
exclusions, oracle publishers, golden changes, normalization, product/helper edits,
new dependency, or global test/build/typecheck gate were used.

Limits: this is source-level forwarding instrumentation, not a kernel trace. Final
namespace equality and PID liveness do not prove absence of transient mutation and
restoration, arbitrary concurrent mutation, or PID reuse. Only the selected
committed input cohort is qualified, not all repository files or strict consumers.
No commit has been made; root review and explicit atomic-commit authorization are
still required.
