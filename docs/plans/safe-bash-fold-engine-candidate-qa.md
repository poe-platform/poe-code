# Fold engine candidate QA

Execute against the current working-tree candidate; never invoke host fold.
Preserve unrelated work. This plan covers the pure engine/export task, not the
later VFS command-registration and CLI integration task.

1. Fetch released GNU coreutils 9.10 as development research, verify archive
   SHA256 `16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`,
   and read `src/fold.c`, the fold manual section and `tests/fold` variants.
   Compare the supplied development revision's `src/fold.c`. Keep observations
   source-derived; do not treat the portable Unicode table as a libc locale.
2. Run the maintained fold unit route. Confirm exact bytes across every split
   of the mapped upstream fixtures, C versus UTF8 counting, separator inclusion,
   invalid decoding, controls, finite-buffer flushes and LF/file state survival.
   Confirm non-byte, forged, proxied and detached inputs reject with `INPUT` and
   close the engine. Cross-realm bytes and Buffer must remain supported; fake
   length/iteration must neither change bytes nor bypass input accounting.
3. Run fold workspace lint (including both TypeScript configurations) and the
   maintained selected safe-bash build closure. Investigate all failures.
4. Stage public safe libraries at a local verification version. Pack and install
   them offline with scripts disabled into a fresh consumer outside the checkout.
   Run the maintained fold runtime and strict NodeNext type fixtures. Through
   that installed export, repeat cross-realm input, invalid-input cleanup,
   spoofed-length budgeting and exact multibyte output checks.
5. Inspect the installed package: no private command package installed, no bare
   private imports in implementation/declarations, and fold implementation,
   declarations, table source and license notices bundled. Audit the engine's
   import closure for host files/process/network/ambient locale access.
6. Record passes, initial failing reproductions, corrected check failures,
   unsupported/unverified runtime cells and omitted broad gates separately.
   No screenshot is required because this task changes no visible CLI flow.
   Original/checkpoint/replay command execution belongs to later integration;
   it is not established by this pure-engine gate. Purge only task-owned evidence.

Use `/out` for temporary evidence. If the host's read-only root prevents creating
it, use ignored workspace `out/fold-candidate-review` for research/staging and a
temporary external installed consumer for isolation, then purge both.

## Execution record, 2026-09-19

Completed steps 1–5 on the current candidate. Verified the archive hash and read
released source/manual and fold.pl, fold-characters, fold-nbsp, fold-spaces and
fold-zero-width tests. The snapshot differs in its separator predicate; these
findings remain source-derived, with no native utility execution.

Two original admission tests failed before the fix: wider typed arrays were
silently truncated, and producer iteration replaced real cross-realm bytes while
spoofed length bypassed accounting. Intrinsic byte-view admission fixes both.
The final maintained fold unit route passed 21 tests, zero skips. Fifteen mapped
upstream fixture variants were checked at every byte split. Additional negative
cases include forged/proxied/detached storage, checked engine underflow and the
4096-byte call boundary. All tests use memory; no fixture files are created.

Fold lint and production/test typechecks passed. An initial deliberate invalid
input cast needed an intermediate `unknown` cast; the corrected lint route
passed. The selected maintained safe-bash build closure passed including
postbuild, using the shared cache (16 builds, zero cache hits). No shared build
implementation or workflow was changed by this pass.

Staged version `0.0.0-fold-candidate`, packed only the three public safe libraries,
and installed offline with scripts disabled outside the checkout. Maintained
fold runtime and strict NodeNext declaration fixtures passed. Installed-export
cross-realm bytes, overridden iteration/length, budget rejection, invalid-input
cleanup and private-package absence controls passed. Bundle inspection confirmed
implementation, declarations, table source and license assets, with no bare fold
workspace imports. An initial inspection incorrectly expected `engine.js`; the
maintained builder bundles runtime into `index.js`, whose presence was verified.
Safe Bash tarball SHA256:
`6b1baa652c0785a76c983fd98f5deae0907b9e8c54f463223f1de3d2d40826d2`.

No unresolved check failures. Native libc locale/diagnostic parity, complete
user-supplied native transcript matrices, browser/workerd execution, CLI/VFS
registration and original/checkpoint/replay command execution remain unverified.
They are not inferred from the portable engine tests. Full repository lint/test/
build gates were omitted for this focused command-engine correction. Screenshots
were omitted because no visible CLI behavior changed. No performance claim is
made from the deterministic tests' duration.

`/out` creation failed because the host root is read-only; task evidence used
the fallback described above and was purged. Unrelated edits were preserved.
Local commits: none. Remote-main delivery: none. Releases/publication: none.
