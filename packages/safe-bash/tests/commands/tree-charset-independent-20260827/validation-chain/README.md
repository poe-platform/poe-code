# Validation-chain supplement

This is a post-inspection validation of immutable candidate
`f1a90436c45208ca248e058a039893233c608daa` (tree
`c5cdfff66e64bb4d68926c4f93a7620eb89e7dcd`, 70 default commands). It is not
a pre-source-commit freeze, full-gate rerun, or full native-parity claim. No
independent pre-source-commit freeze exists. This evidence supplements, and
does not rewrite, the independent result at
`92d1dacd041d90f58fee81922815bbd606cceb8e`.

The final successful `attempt-007` authenticated 233 selected Git blob inputs and a
fixed Git archive, all 314 pinned tool files, the compiler entrypoint and
implementation, 760 isolated build outputs, and all 761 files in the actual
pack/install/move chain. The installed content matches the tar archive, its
dist content matches the isolated build, and all package paths are regular
files whose realpaths remain beneath the moved package. The guarded runtime
recorded 176 uniquely loaded package modules with their paths and SHA-256
hashes, observed exactly 70 default commands and one tree command, and ran a
real UTF-8 tree invocation.

The strict installed consumer compiled with `strict: true`, `NodeNext`, and
`skipLibCheck: false`. Raw `--listFiles` output records the moved root and tree
declarations. A test-only copy of the installed declarations was changed in
exactly `dist/index.d.ts`: the invalid declaration fails with library checking
active and the same copy succeeds with `skipLibCheck: true`; the baseline
package was not modified.

Eight expected controls passed: wrong-package confinement, archived-source
fallback confinement, wrong expected package hash, the two declaration-copy
outcomes, an exact nonsignal status-19 failure, bounded stdout overrun, and an
explicit timeout. All 22 children reached both exit and close, every PID was
absent after close, no workers were created, and the isolated runtime was
removed. No scoped product bug was found.

## Reproduction

From the repository root, use a new attempt number (the driver refuses to
overwrite evidence):

```sh
node tests/commands/tree-charset-independent-20260827/validation-chain/harness/run.mjs \
  --output tests/commands/tree-charset-independent-20260827/validation-chain/attempt-008
```

The driver uses only Node builtins at runtime. It accepts the live development
tool tree only after every file matches the pinned 314-file manifest in the
immutable main evidence commit. If that exact tree is unavailable, it performs
an isolated npm ci from the authenticated candidate lock and authenticates all
314 results before copying them. npm receives explicit empty user/global
configs, an isolated cache/home/temp directory, ignores scripts, and installs
only the locally produced tarball in offline mode. Every child command records
argv, minimal environment, executable hash, deadline, per-stream cap and raw
bounded output, exit and close state, signal, truncation, and post-close PID
absence.

`attempt-006/SHA256SUMS` authenticates every file that existed in that attempt
when the manifest was written. It does not make the directory append-proof;
verification must also reject unlisted later entries if that property is
required.

## Preserved attempt history

- `attempt-001`: failed because the pinned type tree was not at a source-build
  ancestor; raw TS2688 is retained.
- `attempt-002`: fixed tool ancestry, then failed because npm rejected using
  `/dev/null` as both user and global config.
- `attempt-003`: used two isolated empty npm configs, then exposed macOS
  `/var` versus `/private/var` canonicalization in the loader allowlist.
- `attempt-004`: used realpath confinement and reached the product tree run;
  its probe incorrectly required the result to omit documented byte fields.
- `attempt-005`: corrected that assertion and passed the strict compile; its
  proof check compared the compiler's canonical path with a noncanonical temp
  prefix.
- `attempt-006`: canonicalized the declaration proof and passed completely.
- `attempt-007`: repeated the complete pass after adding the safe isolated-tool
  fallback path and independently checking npm's reported SHA-1 tarball shasum.

The earlier `139/139` and `77/77` suites, 34-pair differential, count probes,
and native holdouts were intentionally not repeated. Lowercase `.utf8` virtual
extensions remain outside native-parity claims. The loader evidence covers the
modules actually loaded by this bounded root/tree probe, not every exported
workflow.
