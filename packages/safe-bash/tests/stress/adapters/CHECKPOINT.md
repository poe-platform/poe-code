# Final independent pinned checkpoint

- Pin: **`3a71b0e4cbdf8df1f641da4dae56cc30459c5bbd`**, never moving HEAD; tree `3f9b1f70b9210104dcdd903671b656987b6219d2`.
- Observed **2026-08-26 19:16:49–19:17:42 UTC**, Node **v22.22.2**, npm 10.9.7, Darwin 25.4.0 arm64.
- Evidence root `E=/tmp/virtual-bash-checkpoint-3a71b0e.UzVJco`; snapshot `$E/snapshot`, immutable archive `$E/pinned.tar`; archived files made read-only, existing project `node_modules` symlinked, no install. Build output is outside the pinned-file manifest.
- Curie's **1,377 pass / 29 fail / 6 skip** and earlier `REPORT.md` workingtree/shell-drift evidence remain historical and unchanged. This report establishes only this committed Shell/FS integration checkpoint, not later workingtree state.

## Measured results
- Combined Memory/Real/S3/WebDAV/shared-conformance/adapter-stress run: **778 tests, 778 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo; exit 0** (`adapters.tap`).
- SafeJS integration: **28 tests, 28 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo; exit 0** (`safejs.tap`), including **six actual-checkout tests**: guest values/isolation, cancellation, replay reconciliation, structural local types, and concrete Shell/Memory stdin/pipes/shared writes.
- Scoped strict TypeScript **exit 0** (`typecheck-resolved.log`); root ES2023/NodeNext, strict, unchecked-index, exact-optional, verbatim-module and casing flags inherited unchanged. Roots: the four FS sources/tests, SafeJS bridge/tests, shared conformance and adapter stress, plus imported dependencies; no broad wrapper/shell suite.
- Initial external-config typecheck **exit 2 / TS2688** (`typecheck.log`) was harness `@types/node` lookup, not source failure; explicit `--typeRoots ./node_modules/@types` corrected resolution. Both outcomes retained; no source/assertion changes or test reruns.
- `npm run build`: **exit 0**, no build errors (`build.log`). No global suite or benchmarks run.

## Commit and metadata evidence
- All required revisions are ancestors of the exact pin (each ancestry exit 0); full SHAs and changed-file scopes are in `$E/commit-scopes.log`.
- `d79756a`: Real cancellation source/regression; `4a6f7d6`: shared conformance and independent adapter stress/report/probes; `41f7d6e`: SafeJS bridge and integration tests.
- WebDAV source/docs/tests: `c0f3083` append, `88fcff0` protected overwrite, `10e6c4c` XML, `8a3e26e` body integrity, `7da881f` ENOTDIR, `2a8c68f` LOCK cancellation, `9a324e3` LOCK 207.
- `3a71b0e` changes only Real metadata tests and adapter stress metadata/probe documentation; **Real production source unchanged** (`real-source.diff` empty; assertion diff in `metadata.diff`).
- Shared Real metadata retains **exact equality**: only input becomes `(Math.floor(Date.now()/1000)+86400)*1000`, greater than now and historical mtime; Memory input unchanged. Separate Real millisecond input adds 125 ms; **both existing `<2 ms` tolerances unchanged, not widened**.
- Historical native Date forwarding assertions and standalone historical diagnostic retained. This run passes exact Real optional metadata, millisecond conformance, and historical forwarding; no cache, skip, retry, or relaxed assertion introduced.
- **Prior author-verified controls, not rerun here:** 2,000 fresh future-atime files / 6,000 paired observations without mismatch; 600/600 metadata checks in 200/200 processes (`TIMESTAMPS.md`, `/tmp/virtual-bash-timestamp-controls.json`, `/tmp/virtual-bash-timestamp-repeat.json`). Neither those observations nor this pass proves host-atime immutability; the original unsolicited reader/mechanism remains unidentified.

## Boundary integrity
- All **162 archived files** match before/after/final; SHA-256 of sorted file-hash manifest: `9677d6dc0708ff17ac5350ecb624238f502a124ae574a787afe0c9ee14f6482d`.
- All **49 committed source files** match: source-manifest SHA-256 `11b2fe4945413adda4f5617a9b4774a129ee178d1124ab1094f099883e60adee`; Real source SHA-256 `4977b7780b067cdd16bd8c128982758cd3401d2f72864f786981d2c315b74f82`.
- Read-only private root `/Users/kjopek/Workspace/poe-code/packages/safejs`: all **226 src files** match; source-manifest SHA-256 `f3c7ce1d628d4eb5f53a46db47ebc177881f35fd0de1ef3b8a54a54cba479aca`. Its `package.json`/`tsconfig.json` also match; no private edits.
- Manifests: `$E/{snapshot,source,private-source,private-config}-{before,after,final}.sha256`; summaries `hashes-{before,after,final}.json`; all comparisons exit 0. Boundary hashes do not exclude transient external edits.
- Archive SHA-256 `2b261d941dd9a0541ff9fdd6c37b5267e4b6a27f1ca8028ce6ddda1357218a12`; environment/commands/results retained in `environment.log`, `verify.sh`, `tsconfig.scope.json`, `results.log`. No branch/worktree switch or history repair; only this report staged/committed.

## Exact reproduction
Archive creation from the repository (choose a fresh disposable evidence directory):
```sh
PIN=3a71b0e4cbdf8df1f641da4dae56cc30459c5bbd
E=$(mktemp -d /tmp/virtual-bash-checkpoint-3a71b0e.XXXXXX); mkdir "$E/snapshot"
git archive --format=tar "$PIN" > "$E/pinned.tar"; tar -xf "$E/pinned.tar" -C "$E/snapshot"
chmod a-w "$E/pinned.tar"; find "$E/snapshot" -type f -exec chmod a-w {} +
ln -s /Users/kjopek/Workspace/virtual-bash/node_modules "$E/snapshot/node_modules"
```
Exact measured test/build commands against the retained snapshot (scope config and logs remain under this evidence root):
```sh
E=/tmp/virtual-bash-checkpoint-3a71b0e.UzVJco; cd "$E/snapshot"
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/*.test.ts tests/fs/real/*.test.ts tests/fs/s3/*.test.ts tests/fs/webdav/*.test.ts tests/fs/conformance/*.test.ts tests/stress/adapters/*.test.ts
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs node --unhandled-rejections=strict --import tsx --test tests/integrations/safejs/*.test.ts
node node_modules/typescript/bin/tsc -p "$E/tsconfig.scope.json" --typeRoots ./node_modules/@types --pretty false
npm run build
```

## Remaining limits
- Remote evidence is **mocks plus loopback, not live-provider/SDK certification**. S3 transport must enforce declared conditional capabilities, cancellation and complete copy responses; WebDAV requires compliant locks (collections always) or explicit file-ETag policy with strong, distinct tags across content/type changes. Weak-validator reuse can defeat that opt-in policy; protocol references remain in `src/fs/webdav/README.md`.
- Remote rename remains **non-atomic**; lock cleanup is best-effort, source/ancestor races and partial remote changes remain possible. Real is **not raceproof against hostile external mutation**; lexical/host checks are not a race-free sandbox.
- **Independent comparison superiority, full-shell/global completion, and the full requested 72 hours are not established.** This is a bounded committed checkpoint, not closure of the wider product or Curie's global failures.
