# GNU strings argv0 binding: author evidence

Candidate: `8784a8fc0484313b914fe1ae6db33a8cfd0e0be4`.
This is implementation-author validation, not independent review or a full gate.
The separately assigned reviewer receives `/tmp/strings-binding-author-candidate.txt`.

## Exact change

Only three executable-code edits in the existing helpers: `capture` accepts
`argv0 = executable`, forwards it to `spawnSync`, and the GNU strings caller
supplies its existing `defaultStrings` as logical argv0. Actual executable
selection, authentication, returned identity, args, stdin, environment, timeout,
output cap, setup, and cleanup are unchanged. No product/root files changed.

The committed canonical test, fixture definitions and golden JSON are unchanged.
No publisher entrypoint ran; no golden recapture, diagnostic normalization,
assertion relaxation, dependency installation, or split/env test work occurred.
The original 1,564-byte lone-dash diagnostic remains byte-for-byte unchanged:
SHA256 `408835816cfd774536a0bffae5ade7814e96e2e8e4091618b47bb5edfd796705`.

| Candidate input | SHA256 |
| --- | --- |
| `tests/commands/stream-inspection/oracle.ts` | `7e6b128a0f52c42f45ac3b43edbda9b7bed71671d0fc584069bb692ebb8e35c5` |
| `tests/commands/stream-inspection/gnu-strings-oracle.ts` | `3bca0a375335f55d1fd5145362c88ba7ad5912db0109c76f14b0e03f3cd9c2c0` |
| `binding.test.ts` | `0148fb38e8ee1b2857279a33d31e61c0e2880a82c7b17fcbba883698596784be` |
| `tests/commands/stream-inspection/gnu-strings.test.ts` | `5c580bc131e382565c7dd2b84da5368813749b9e1526590fc0853ef8af9a8d57` |
| `tests/commands/stream-inspection/gnu-strings-cases.ts` | `8b9a59f45b3e075db07a4f5073bcf516eb99ee8f29be7e695d92d48f5df79eca` |
| `tests/commands/stream-inspection/evidence/gnu-strings.json` | `e00ba3920f79dcb4ef58d0a19242e07d1de6bd1698c66c56c0a27bb5eabb1d72` |

## Regression and canonical results

`binding.test.ts` copies the two helpers without transforming their bytes to an
owned temporary module directory. Original case/helper imports are symlinked,
not rewritten. Module-relative native fixture scratch therefore stays outside
the checkout, including when this regression runs from the live repository.
The temporary module, scratch, and relocated binary are removed in `finally`.

The three bounded regressions verify:

- Omitted argv0 equals explicit executable argv0 and reports the expected name.
- A nonexistent logical name affects only argv0; the actual Node executable,
  its identity/hash, and a literal argument remain intact.
- A relocated authenticated GNU binary preserves all 13 original observations,
  including file-label controls. Returned identity describes the relocated binary.
  Omitted argv0 reproduces the original failure; pinned argv0 restores the exact
  original observation and diagnostic hash. The pinned logical path is asserted
  equal to the original golden identity's executable path.

The unchanged canonical `gnu-strings.test.ts` contributes 14 tests: 13 original
vectors and its strict live deep comparison of all original native observations.
Combined with the regressions: **17 passed, 0 failed/skipped/TODO/cancelled**.
Scoped strict TypeScript checking of both helpers and the regression, including
their imported source graph, passes with `--noEmit`. This is not the repository's
whole typecheck/build or a full test suite. The live-check opt-in remains unchanged.

## Frozen execution and native prerequisites

Author run: August 27, 2026, 15:47:33.086–15:47:34.914 UTC.
Retained output: `/private/tmp/strings-binding-author-BrtdBI`.
Run from the repository:

```sh
node tests/commands/stream-inspection-stress/argv0-binding-author/verify.mjs 8784a8fc0484313b914fe1ae6db33a8cfd0e0be4
```

`verify.mjs` SHA256:
`e855dcc1d5a465009a07a1c448a108e7a8340456ec1081a6557fdff519e0c907`.
The runner is evidence tooling committed separately from the candidate. It
archives only committed candidate `src`, the original stream-inspection cohort,
the new regression, and `package.json`. No live product/helper inputs are overlaid.
The tar archive SHA256 is
`8d031f3db47bb1c120c6bd340b60b65278bbed8f3c06b89d489effe4cdbb2bff`.
The archive contains selected inputs, not a whole-repository gate snapshot.

The existing native executable is
`/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings`,
SHA256 `90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f`.
It is GNU Binutils 2.44, Darwin arm64,
`--enable-default-strings-all --with-system-zlib`. No new native build/download
was performed. The runner checks the original, stages identical bytes as
`/private/tmp/strings-binding-author-BrtdBI/strings` with mode 0700, and verifies
original/staged hashes after execution. Observation argv0 remains the original
path while `STREAM_GNU_STRINGS` selects the staged executable.

Runtime: Node v22.22.2, macOS 26.4.1 build 25E253, tsx 4.23.12,
TypeScript 5.9.3, @types/node 22.20.1. Existing repository `node_modules` is
symlinked into the isolated tree. Dependency package JSON versions/hashes are
recorded, not a full dependency-tree or system-library reauthentication.
`receipt.json` records exact commands, environment overrides, hashes and PIDs.
`canonical-and-regressions.tap` preserves the unmodified test stdout.

## Integrity, cleanup, and limits

Before/after snapshots cover all 298 extracted-tree entries, including file bytes,
modes, directories and symlink targets. Full namespace enumeration also detects
new entries remaining after execution; it does not detect transient additions
removed before the final snapshot. The `node_modules` symlink is not traversed.
Both retained pretty-printed manifests have SHA256
`936d836a6a9cb056b6f7704edf85b7fb5fc0364eff4370189dacd24fdc3bbb5a`;
the compact manifest hash in the receipt is
`a84d092f32a65cf2a116c65f3c8d23fd3c46e4c0d62c2825f508f66f09115213`.
The archive itself is also unchanged after execution.

The isolated source tree and staged binary were removed. All six runner-owned
direct child processes completed synchronously and returned ESRCH on post-run
PID checks; the runner session exited 0. Tests use synchronous native spawns;
nested native PIDs are not individually instrumented. No background listener or
unreaped owned session remains. Original native binary and historical evidence
remain untouched. Unrelated dirty/index changes were excluded from both commits.

This evidence preserves unchanged fixture setup/effects and verifies output,
status, signal, fixture hashes, cleanup and executable identity. It does not add
per-syscall native input-consumption or intermediate file-effect instrumentation.
It does not establish GNU/Linux/BSD behavior, broad command parity, performance,
superiority, 72-hour completion, or independent reviewer acceptance.

Original read-only diagnosis remains at
`/tmp/safe-bash-strings-readonly-Mn1NHMMM/REPORT.md`; historical failures and golden
captures are not rescored or replaced by this narrowly scoped repair.
