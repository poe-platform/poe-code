# Issue 678: in-package native seek packaging proposal

Date: September 9, 2026. Status: production candidate implementation in progress; release is not authorized or qualified. The original proposal below is retained as design history, not a description of completed work.

## Implementation checkpoint: September 9, 2026

Directory-aware retained-read admission and pinning were implemented before root authorized the bounded production-native candidate. The current candidate uses an END-only asynchronous Node-API 6 operation; earlier arbitrary-seek proof results do not qualify the changed C source. At this initial checkpoint, retained read/resize integration was under test and the truncate command had not yet opted into directory-reference admission. Subsequent implementation and qualification are recorded in `docs/plans/issue-678-truncate.md`: the live command now requests directory references, Real ext4/XFS controls pass, and the current filesystem-only artifact passes the exact Node 18.18.0 native slice after relocation. Memory-directory behavior, version-banner differences and broader release qualification remain unresolved. The independent foundation commit deliberately excludes the unfinished command and its registration.

The implemented registry is `packages/safe-fs/native/assets.json`: `native/seek.c`, `native/loader.mjs`, `src/native/loader.d.ts`, private `#safe-fs-native-seek`, and `native/fs-seek`. Its single current target derives `linux-x64-glibc.node` with a minimum glibc of 2.31. This is a measured candidate profile, not support for every declared Node engine or release platform. Unsupported build hosts emit loader/types and an empty target manifest without compiling; supported hosts fail rather than silently omit an unsuccessful compilation.

The separately approved dependency installation pins build-only `node-api-headers` 1.9.0 in SafeFS devDependencies and the lockfile. It adds no runtime dependency or install-time compiler. The maintained workspace build now invokes `scripts/native-assets.mjs` after guarded TypeScript emission. The helper derives root and standalone asset placement, records source/loader/declaration and four Node-API header hashes, bounds binary size, and preserves binary bytes without decoding executable formats. Memfs transition tests reproduce and fix a supported-to-unsupported rebuild failure: only registered stale generated binaries are retired, and unexpected files fail admission without deletion.

**Trust-scope change from the original compiler proposal:** the current helper trusts the build host's system toolchain and system headers. It resolves `/usr/bin/cc`, uses fixed arguments and a restricted child environment, bounds compiler time/output, uses owned staging, and rechecks recorded inputs after compilation. It does not sandbox the compiler's reads, authenticate the linker/sysroot/transitive system-header closure, or establish a hermetic build. Observed hashes are integrity/provenance records, not independent authentication of an arbitrary toolchain. The stricter toolchain-closure proposal below remains unimplemented; release provisioning and its trust decision are separate outstanding work.

The canonical package guard independently recollects bounded raw assets and rejects forged serialized closure claims. The lazy loader checks runtime facts, file type/size and digest before loading the adjacent binary. These checks assume trusted installed package files; they do not make the integrity-read-to-module-load interval race-proof. Initial END-only native captures have an unavailable FIFO case; that missing case is not a pass. Native running syscalls cannot be forcibly cancelled, so admitted work must retain its descriptor until actual completion.

The maintained root build v16 completes all 70 declared workspace builds and root suffix stages; the v15 local-IPC sandbox failure is preserved. The current SafeFS directory passes 3,440 tests across 79 files. Actual built-public execution passes 36 controls independently on Node 22.23.2 and Bun 1.3.8: 32 exact GNU directory-offset diagnostic comparisons across eight wrappers, empty/populated directories and two filesystem profiles, plus four retained regular-file controls. EXT returns INT64_MAX while XFS returns zero; no stat-size substitution supplies these values. This proves these offset diagnostics, not equality of complete raw runtime traces or of the still-unintegrated truncate command.

A scripts-disabled offline install of the local SafeFS-only tarball is moved to a fresh peer consumer location before execution. Node and Bun each pass eight installed direct-backend controls there, including four exact GNU directory-offset diagnostic comparisons. Root, SafeJS, Safe Bash and build-header packages are absent; the installed binary matches its recorded opaque digest. Actual installed strict NodeNext/ES2022 declarations pass, and a browser-conditioned bundle has no native inputs/external imports and executes its memory-filesystem control on Node. The eight-control installed cohort is separate from, not a replacement for, the 36-control built-public cohort. Initial capture input-type/resolver failures remain preserved; only those fixture errors were corrected, without omitting their controls. Source bindings, tarball hash, individual receipts and limitations are recorded in `out/issue-678-tmp/native-fs-candidate-v1-qualification.json`. Packed root, Worker-only, minimum-engine and current full-root unit/lint gates remain separate.

## Original proposal and remaining acceptance criteria

Subsequent validation found and corrected outdated root bundle fixtures missing
the new registry/asset closure (four failures) and cleanup control flow rejected
by the maintained `no-unsafe-finally` rule. Native asset reads and staging cleanup
must preserve falsey primary failures while settling outside `finally`, without
disabling the rule. Those follow-up changes invalidate the earlier loader/helper
source binding for whole-candidate qualification; the earlier receipts remain
historical, not silently reassigned to the changed candidate. A fresh maintained
unit/build/lint and consumer checkpoint is required.

## Decision and scope

Use one original, narrowly scoped Node-API addon owned by SafeFS, shipped inside the existing packages. Keep its loader outside JavaScript bundles and address it through one private package import. Derive artifact placement, private-import targets, copy admission and package checks from one declarative asset registry. Do not add a runtime dependency, another published package, install hook, runtime compiler, downloaded fallback, or provider-name branch.

This proposal covers packaging and loading only. Root owns descriptor pinning, directory-aware read admission and the eventual retained-handle integration. It does not settle those contracts or make synchronous native work cooperatively cancellable.

The preserved proof is `out/issue-678-tmp/napi-seek-feasibility-v1/handoff.json`: original C, public Node-API version 6, Linux x64 with 64-bit `off_t`, Node 22.23.2 and Bun 1.3.8, 16 executed controls per runtime. Its header tree is Node 22.22.0 and compiler is Ubuntu GCC 7.5.0. The proof borrows an fd and neither opens nor closes it. It is not a production-safety, async-lifecycle, minimum-engine or cross-platform certification. The separate async proof now passes ten controls independently on each runtime. Its supplemental exact audit records 23 equal offset/errno payloads but ten differing complete raw control traces; it does not establish general trace or error-payload equality. Neither proof authorizes production integration. Keep the eventual operation boundary limited to retained end-seek rather than exposing the experimental arbitrary-offset API.

## Current constraints, grounded in maintained code

| Authority | Current behavior relevant to this change |
| --- | --- |
| `packages/safe-fs/package.json:2`, `packages/safe-fs/package.json:34` | Workspace is private `@poe-code/safe-fs`; build is output guard followed by `tsc -p tsconfig.json`. There is no native build/copy phase. |
| `scripts/bundle-fs.mjs:8`, `scripts/bundle.mjs:199` | Root compiles SafeFS source into the canonical split Node/browser bundles, not by copying its workspace runtime. Node outputs live under `packages/safe-js/dist`; chunks have hash-dependent names. Node target remains `node18.18`. |
| `packages/package-lint/src/bundle-policy.ts:5`, `packages/package-lint/src/bundle-policy.ts:86` | Three canonical FS routes and the existing `#safe-fs-platform` mapping are exact policy, not an open private-import allowance. Root's platform mapping is declaration-only at runtime (`default: null`). |
| `packages/package-lint/src/bundle-policy.ts:224`, `packages/package-lint/src/bundle-policy.ts:336` | Root rejects nested canonical package scopes, duplicated JS runtimes under `packages/safe-fs/dist`, foreign canonical inputs, and canonical external edges other than admitted Node builtins. A new private native edge currently fails correctly. |
| `scripts/package-safe.mjs:35`, `scripts/package-safe.mjs:114`, `scripts/package-safe.mjs:152` | Standalone artifacts retain unbundled FS output at `dist/safe-fs/...`; copied inner FS `package.json` is excluded. Only `#safe-fs-platform` is specially understood; another private specifier currently throws. |
| `scripts/package-safe.mjs:140` | Non-JS bytes are copied without text conversion, but generic discovery/copy is not binary authentication. Dynamic loader-selected assets are not established by ordinary literal-import rewriting. |
| `scripts/guard-package-dist.mjs:5`, `scripts/publish-bundle.mjs:1` | Existing output containment/staging protects declared destinations; it is not compiler/header admission or a native artifact census. Preserve these guards and add asset-specific admission, rather than bypassing them. |
| `package.json:338`, `package.json:410`, `scripts/package-safe.mjs:181` | Root package is `poe-code`, shipping `packages/safe-js/dist` plus FS declarations, with Node `>=18.18`. Generated packages are `@poe-platform/safe-fs`, `@poe-platform/safe-js`, `@poe-platform/safe-bash`; SafeFS currently has no workspace `engines`, so packaging supplies Node `>=18.18`. Do not rename these scopes or raise the engines to match the proof. |

## One registry and exact resolution

Propose `packages/safe-fs/native/assets.json`, a finite build-owned registry, not a user configuration surface. Its single entry defines:

- id `seek`, private specifier `#safe-fs-native-seek`, asset directory `native/fs-seek`;
- original source `native/seek.c`, textual loader `native/loader.mjs`, declaration `native/loader.d.ts`;
- loader/type basenames, Node-API level 6, signed 64-bit offset requirement;
- a declared target record, initially `linux-x64-gnu`, with its admitted toolchain/sysroot identity and a fixed relative binary pathname;
- runtime admission requirements and the release target set. Artifact digests belong to generated, authenticated build receipts, not guessed constants or hashes computed from an arbitrary file and then treated as trusted.

One build helper reads and validates this registry. It projects these locations; callers must not independently reproduce the target/path table:

| Context | Private runtime target, relative to its owning package scope |
| --- | --- |
| SafeFS workspace `package.json` | `./dist/native/fs-seek/loader.mjs` |
| SafeFS source `src/package.json` | `./native/loader.mjs`, an explicit ESM re-export of `../../dist/native/fs-seek/loader.mjs`; source type target `./native/loader.d.ts` permits typechecking before native emission |
| Generated SafeFS `dist/package.json` | `./native/fs-seek/loader.mjs`, with the adjacent generated type target |
| Root `poe-code/package.json` | `./packages/safe-js/dist/native/fs-seek/loader.mjs` |
| SafeJS workspace `packages/safe-js/package.json` | `./dist/native/fs-seek/loader.mjs`, for canonical bundles inside the existing worktree package scope |
| Generated `@poe-platform/safe-fs/package.json` | `./dist/safe-fs/native/fs-seek/loader.mjs` |

The root asset directory is derived from `canonicalFsProfiles.node.outdir`, not a second hardcoded copy table. Standalone placement is derived from `artifactPath` applied to workspace FS output. Keep binary/receipt paths relative to the loader directory in every layout. Do not put a `package.json` in the root canonical output directory or ship a second SafeFS JS implementation under root `packages/safe-fs/dist`.

Resolver validation is preserved in `out/issue-678-tmp/native-import-scope-proof-v1/`: Node and Bun both reject the original source mapping with a `../dist` private-import target, and both reject a root-only private mapping when the importing module has a nearer package scope without that mapping. Both accept an in-scope explicit ESM forwarder to the built loader. The production forwarder lives one directory deeper than that fixture, hence its `../../dist` relative path. Derive both worktree and packed mappings from the registry; root mappings do not cross the existing SafeJS workspace package boundary. Source execution requires the maintained build, not an implicit fallback. Keep source declarations inside the source package scope and do not replace its runtime route with `null` to evade resolver tests.

The loader is unbundled ESM, uses builtin `createRequire(import.meta.url)` and only the declared adjacent `.node` asset. It selects a finite registry target using admitted runtime facts, validates the artifact receipt, and loads that file; no cwd lookup, ancestor package search, environment path override, source-tree fallback or generated chunk-relative binary path. Both root and standalone use the same loader bytes. Native bindings are private: no new public subpath export or public borrowed-fd API.

Only the Node retained-handle adapter may request `import("#safe-fs-native-seek")`, lazily on an authorized operation. Ordinary imports must not require a compiler or load the addon. Loader outcome caching must distinguish unloaded/success/failure without truthiness-based error loss. An unsupported target produces explicit `ENOTSUP` at the optional operation boundary; an expected binary that is missing, corrupt or fails loading is a packaging/load failure, not a zero/stat-size answer or a search for another implementation. Preserve the original failure for diagnostic reporting. Mapping this failure into the existing FS error model is part of root's integration review.

## Build, package and policy changes

1. Extend the maintained SafeFS build after guarded TypeScript emission with the native asset helper. It compiles only an explicitly admitted target/toolchain, emits a receipt, copies loader/types, and materializes the built private imports. Normal `npm run build` and the maintained selected-workspace closure reach this phase; no alternate unguarded production build and no npm install/postinstall compilation. A missing required build toolchain fails explicitly.
2. `resolveCanonicalFsBuilds` externalizes exactly the registered private edge in the Node profile. The browser build must not externalize it to conceal a leak. After canonical JS publication, authenticate/copy the registered asset closure to the projected Node output, then run the package census. Keep all JS outside this closure subject to existing esbuild graph checks.
3. Add an explicit authenticated native-asset closure to bundle-policy input: registry identity, owning profile, private mapping, loader and type dependencies, binary sizes/digests, and actual packed membership. Permit the one Node private edge only when that closure validates. Reject unexpected native files, missing/stale binaries, changed loader bytes, wrong-profile placement, an unmapped edge and private edges escaping the package. Do not generalize the existing builtin allowance to arbitrary `#...` imports or exempt duplicate runtime checks.
4. Extend `packageSafeLibraries` to recognize only registry-owned private imports for SafeFS, enqueue their exact artifact closure, and emit the projected private map. Authenticate native files before generic copying. Parse/rewrite textual JS/declarations only; treat `.node` bytes as opaque bounded bytes. SafeJS and Safe Bash retain their dependency on `@poe-platform/safe-fs` and must neither copy the binary nor retain a private native import.
5. Root's existing `files` directory entry already covers the projected canonical asset directory; standalone `files: ["dist"]` covers its layout. Validate actual tarball membership nevertheless. Root's existing same-run archive includes `packages/*/dist` (`.github/workflows/release-validation.yml:42`); retain digest-verified restoration rather than recompiling during publication.

Tracked root/workspace/source package mappings are projections, checked against the registry on ordinary builds. Materialize their initial changes with JSON parsing/deep merge during implementation; do not make routine builds silently rewrite tracked manifests. Generated dist/standalone manifests are written by their maintained producers.

### Browser and Worker boundary

The native private map has `browser: null` and `workerd: null` before its Node/default target. This alone is insufficient: browser/Worker graphs must never import the Node adapter or loader in the first place. Keep `src/core.ts` and `src/platform/browser.ts` native-free; do not attach the loader to the shared platform object.

Current root canonical exports and generated standalone exports primarily encode `browser`, whereas the workspace manifest additionally declares `workerd`. Derive a `workerd` projection of the existing portable/browser FS profile and Node-only null routes, including the generated platform import, rather than allowing a Worker-only condition to choose the default Node graph. Preserve exact canonical-export/private-map policy checks with the new derived projection. Test `browser` and `workerd` independently, not just both conditions together. This is a real manifest/guard change to validate, not a claim that current Worker resolution already supplies the proposed boundary.

Browser/Worker graph acceptance requires zero native loader, `.node`, `node:module`, compiler or private-native edges, including type closure. A Node-only import must reject through its declared null route. No dummy seek implementation belongs in the portable bundle.

## Compiler, header and artifact admission

- Admit a pinned toolchain/sysroot and headers bundle as build inputs. Use explicit compiler paths/arguments, no shell command construction and no ambient `CC`, `CFLAGS`, include-path or library-path injection. Canonicalize the admitted toolchain installation and bind its identity, including compiler subprocesses/linker and required runtime libraries, not merely `/usr/bin/cc`'s display name.
- Before compilation, enumerate/hash bounded regular source/header inputs beneath approved canonical roots, including the Node-API headers and C/system headers. Reject escaping links, unexpected roots, missing entries and untrusted header overlays. Run the compiler with read access restricted to the admitted toolchain/source/sysroot closure and write access restricted to owned staging. A post-compile `-MD` dependency file checks the declared closure; it cannot retroactively authorize files the compiler already read.
- Fix the Node-API/offset flags and target settings in the registry-backed build contract; retain compile-time guards for the initial platform and `sizeof(off_t)`. Header Node 22.22.0 was a proof input, not a production support policy. Pin and authenticate the chosen release header version explicitly; do not fetch headers during import, installation or an implicitly networked build.
- Generate a receipt binding source/registry/loader/toolchain/header hashes, command arguments, target, output length and SHA-256. Associate it with the exact candidate and same-run build artifact. Hash the bounded raw binary; do not disassemble, parse ELF/PE/Mach-O, stringify it, embed base64, or execute it as an authentication step.
- Authenticate source receipt and bytes before copying; validate destination containment, stage without following attacker-controlled destinations, verify output bytes and publish loader/manifest last. Publish only the exact registered asset set and remove only stale files owned by that set. Existing generic dist guards are necessary but do not establish these additional guarantees.
- Runtime hash checking detects corruption relative to the shipped receipt; it does not make a replaced binary plus replaced receipt trustworthy. Nor does hash-then-`require(path)` eliminate a concurrent pathname replacement race. Trust a verified, immutable installation; explicitly retain this boundary instead of claiming adversarial-host protection. Native code runs with host process authority.

## Minimal implementation write-set

No files in this list are changed by this design task except this plan. Root must allocate owners before implementation.

| Slice | Exact proposed files |
| --- | --- |
| Registry, reviewed native source and relocatable loader | New `packages/safe-fs/native/assets.json`, `packages/safe-fs/native/seek.c`, `packages/safe-fs/native/loader.mjs`, `packages/safe-fs/native/loader.d.ts` |
| Shared build-time projection/admission/compiler/copy helper | New `packages/safe-fs/scripts/native-assets.mjs`, `packages/safe-fs/src/native/loader.mjs`, `packages/safe-fs/src/native/loader.d.ts`; edit `packages/safe-fs/package.json` build/private mappings and `packages/safe-fs/src/package.json` source mappings |
| Private typed adapter boundary | New `packages/safe-fs/src/node/native-seek.ts`; eventual call sites in `packages/safe-fs/src/fs/real/index.ts` belong to root's separate pinning/API slice, not this packaging design |
| Root bundle/standalone assembly | `scripts/bundle-fs.mjs`, `scripts/bundle.mjs`, `scripts/package-safe.mjs`, root `package.json` and `packages/safe-js/package.json` private/condition projections |
| Canonical authority | `packages/package-lint/src/bundle-policy.ts` for exact registered asset closure and portable-condition projections |
| Narrow unit controls | New `packages/safe-fs/tests/native-assets.test.ts`, `packages/safe-fs/tests/native-seek-loader.test.ts`; extend `scripts/bundle-fs.test.ts`, `scripts/package-safe.test.ts`, `packages/package-lint/src/bundle-policy.browser.test.ts`; new `packages/package-lint/src/bundle-policy.native.test.ts` |
| Packed/native consumer controls | New `scripts/fixtures/safe-packages-native-seek.mjs`; extend `scripts/fixtures/safe-packages-browser.mjs`, `scripts/fixtures/safe-packages-types.mts`, `scripts/fixtures/safe-packages-fs-only.mjs` |
| Release-owned admission and execution wiring | `.github/workflows/release-validation.yml`, `.github/workflows/release-safe.yml`: explicit admitted toolchain inputs and packed consumer execution; preserve existing same-run root restore in `.github/workflows/release.yml` without an unnecessary change there |

Generated outputs: workspace `dist/native/fs-seek/**` and `dist/package.json`; projected root `packages/safe-js/dist/native/fs-seek/**`; standalone `dist/safe-fs/native/fs-seek/**` plus its generated root manifest. Do not commit build binaries or change READMEs, package scopes, dependencies or engine requirements as an incidental part of this work.

`scripts/bundle-assets.mjs` currently describes unrelated GitHub workflow text assets. Do not copy that extension-scanning model for native binaries or add a second seek registry there. The FS-owned helper is the one source consumed by build/bundle/package routes. Any further census/maintained test registration changes discovered during implementation require explicit ownership, not an inventory bypass.

## TDD and consumer acceptance

1. Memfs + injected tool runner: red for absent declared binary/private mapping; then exact source-to-workspace/root/standalone projections, finite target selection, missing header/toolchain, traversal/link escape, oversized/changed binary, receipt mismatch and copy failure. Inject arbitrary nontext bytes and assert byte-identical copying with no text-parser call on binary paths. No native compiler or disk fixtures inside unit tests.
2. Loader tests: deferred native load, unchanged non-native imports, unsupported target explicit failure, corrupt/missing supported artifact, no source/ancestor/cwd fallback, one binding identity, and no runtime tool spawn/download. Preserve original errors rather than replacing all failures with unsupported status. The wrapper must not expose a new public native module.
3. Canonical/package tests: a private edge remains red without the matching registry/mapping/asset census; reject forged closure, foreign targets, duplicate FS implementation, assets leaking into SafeJS/Bash standalone packages, and wrong root-vs-standalone relocation. Cover the nearest owning scope separately for source, built workspace, worktree canonical bundles and packed root; reject private-import targets escaping that scope and missing SafeJS worktree mappings. Verify the explicit source forwarder after the maintained build and source typechecking before native emission. Preserve all current exact capabilities/export assertions. Validate `.mjs` loader dependencies with the existing AST-based approach, never a blanket private-import exemption.
4. Explicit native consumer gates, separate from fast unit tests: use the actual candidate root tarball and standalone FS-only tarball installed in fresh isolated directories with scripts disabled, no source checkout or ambient ancestor dependencies. Move the consumer/install directory and change cwd. Exercise root canonical and standalone Node routes, retained bigint end-seek, errors and shared loader identity. Verify packed binary hashes/membership before running. The tested syscall necessarily loads executable code; that is a declared behavioral test, not binary-format inspection.
5. Browser and Worker-only condition bundles plus strict NodeNext declarations must pass without native dependencies or loading; preserve existing `node >=18.18` compatibility by testing the declared lower bound and supported release lines before claiming it. Add Bun execution to the existing scoped artifact gate, but do not substitute its reported Node compatibility string for a real Node test. Workflow changes use maintained workflow lint, not new workflow unit tests.

## Blocking decisions and limits

- Measurements remain confined to the particular Linux x64 host. Besides Node 22.23.2 and Bun 1.3.8, explicit additional Node 18.20.8 and 20.5.1 profiles now pass the ten async controls with the same addon bytes; the isolated version-guard change, earlier unavailable FIFO attempts and approved retries are preserved under `out/issue-678-tmp/napi-seek-async-runtime-extension-v2/`. This is not exact Node 18.18 minimum coverage. `linux-x64-gnu` is a proposed production target label; its minimum glibc/sysroot baseline and reliable runtime admission are not yet qualified. Unknown libc/runtime facts must not select a binary by guesswork.
- Node-API level 6 is not evidence that every runtime covered by Node `>=18.18` has passed this addon. Node 18.18 and the other supported lines, plus repeatable Bun qualification, remain release gates. Keep the existing engines; do not evade these gates by changing them.
- No macOS, Windows, musl, arm64 or other-architecture artifact is established. Windows would also need a reviewed descriptor/syscall implementation and error semantics; renaming the Linux artifact or adding a stat-size fallback is not support. Do not add package-level `os`/`cpu` restrictions that would unnecessarily disable portable JS elsewhere. A deliberately narrower optional seek scope must be explicit.
- Current release runners do not establish the pinned compiler/header/sysroot closure merely by being Ubuntu/Node 22. Toolchain provisioning, cross-target artifact production, authenticated assembly and tests must be designed into the existing release routes before publication.
- Async syscall lifecycle, fd retention against close/reuse, cancellation/draining, directory-aware acquisition and arbitrary filesystem behavior remain with the parallel owners. This packaging proposal neither duplicates that API work nor closes the known GNU nonregular-seek/large-value gaps.

## Installed root qualification — September 9, 2026

The following evidence advances the earlier packaging proposal without changing
its unsupported-target or GNU-parity limits. The candidate is the current mixed
worktree at local HEAD `2bc5fc996e458a883c27f5eb9b87d9d1a86e5de6`, including
uncommitted truncate work; it is not an exclusively committed release artifact.

- After the normal maintained root build, the root tarball contains 5,069 files
  whose bytes exactly match the pre-pack worktree. Archive SHA-256:
  `a0c7d86a02831d1fcf72c8a3b6fbb37d2b43cc202d95ef30421534e574dcc43b`.
  The native loader, manifest, declarations, and 17,544-byte Linux x64 glibc
  binary are present with their expected bytes. Evidence:
  `out/issue-678-tmp/root-pack-verification-v2.json`.
- npm 10.9.8 unexpectedly invoked `prepare` during the earlier dry run despite
  `--ignore-scripts`. That stderr remains preserved. There is no pre-dry-run Git
  config baseline, so its prior contents are not claimed unchanged. An isolated,
  integrity-checked npm 11.0.0 tool then passed positive/negative lifecycle
  controls and packed the real root offline with scripts disabled. Twenty
  protected repository metadata/hook files remain unchanged from this later
  pre-pack baseline. No manifest scripts were removed or replaced with success
  sentinels, and no project/global dependencies were upgraded.
- The verified tarball was installed with lifecycle scripts disabled and
  optional dependencies explicitly omitted in a fresh `/var/tmp` consumer.
  The consumer was moved before product execution; the old path and all ancestor
  `node_modules` directories are absent. All 5,069 installed package files still
  match the archive/source baseline, and the lockfile integrity matches the
  actual tarball. This is not a default-install or postinstall qualification.
- Actual Node 18.18.0, Node 22.23.2, and Bun 1.3.8 each pass the same six public
  native control groups: shared canonical/Node identities, initial bigint END
  offset, retained-inode resize after path replacement, pre-abort reason and
  subsequent valid seek, canonical EBADF after close, and exactly the installed
  native binding in the module cache. Each run closes its one handle and checks
  removal of its owned fixture. These qualify the exact Node minimum for this
  public route, not every root API or all versions allowed by the engine range.
  Evidence: `out/issue-678-tmp/root-installed-checkpoint-v1.md` and linked raw
  runtime/relocation reports.
- The extracted root's actual browser-condition Bash and filesystem entries,
  hosted in Node 22.23.2, pass 16 fresh GNU numfmt comparisons with exact
  stdout/stderr/status and 16 disposed shells. The sandbox-denied first attempt
  remains separate from the approved successful rerun. This is not a browser
  engine test or full numfmt parity. Evidence:
  `out/issue-677-source-audit-v2/packed-root-browser-condition-v3.json`.
- The installed public filesystem core and Bash entries bundle with no external
  imports or native inputs under both `browser` and the maintained combined
  `workerd,worker,browser` condition set. Each graph contains only three installed
  package modules plus the in-memory consumer entry. Both profiles reject the
  explicit Node-only filesystem export. This is condition-aware bundling, not
  Worker execution or a claim about a condition set that omits `browser`.
  Evidence: `out/issue-678-tmp/root-installed-portable-bundles-v1.json`.
- Strict NodeNext declaration checks, with library checking enabled, pass the
  selected public native filesystem and portable Bash/retained-handle fixtures.
  The negative fixture retains exactly TS2322 and TS2345 for assigning a bigint
  seek result to number and supplying bigint to the number-valued resize API.
  The first compiler invocation returned expected statuses but failed the
  isolation audit because its checkout cwd supplied ambient Node declarations.
  The corrected invocation runs from the moved consumer: every resolved file is
  inside that consumer or the explicitly supplied TypeScript standard library.
  TypeScript 5.9.3 is test tooling; pinned `@types/node` 25.9.4 was installed only
  as consumer-local test tooling. No `skipLibCheck`, diagnostic suppression,
  repository declaration fallback, or public dependency change was introduced.
  Evidence: `out/issue-678-tmp/root-installed-types-verification-v2.json`.

Memory directory-reference semantics and version identity remain unresolved.
These checks do not establish full root declaration/API coverage, actual browser
or Worker execution, other native targets, syscall shutdown fault behavior,
hermetic release toolchain provenance, remote-main delivery, or publication.

## Clean committed-root qualification: September 9, 2026

A separate artifact is built from exact committed HEAD
`1761995e2842a3d7decf12abe8cce3664fca7a74`, not the mixed worktree used above.
The admitted Git archive contains 49,960 blobs; all remain byte-identical after
the normal `npm run build`. All 1,638 root esbuild inputs resolve inside the
isolated source tree. Dependency installation disables lifecycle scripts;
the maintained build itself runs normally and succeeds. This does not establish
hermetic compiler/sysroot provenance.

The actual npm tarball has SHA-256
`63bfe451abbc005b499d9afb33d1d6fc101baaf3ad6d72d5a1904eb448ffe74b`.
All 5,053 members match the pre-pack built files, and all installed files match
after relocation to `/var/tmp/poe-code-committed-consumer.b42WMd-relocated`.
The package is a real directory, the old consumer path is absent, and no
ancestor `node_modules` supplies fallback dependencies. Compared with the older
5,069-member mixed-worktree artifact, this package excludes the four truncate
outputs and twelve stale browser/portable outputs. The two artifacts are not
byte-equivalent; earlier qualification is not silently transferred.

The committed four-utility fixture passes its cmp, fmt, shuf and numfmt
workflows on Node 22.23.2, Bun 1.3.8 and Node with the browser condition.
Only its public import specifier changes from the scoped package to the root
export, using the maintained TypeScript-AST rewriter. Reversing that one change
reproduces the original fixture bytes. These are maintained expected cases,
not fresh GNU oracle captures; truncate remains absent from the exact inventory.

Six selected public retained-handle/native controls pass separately on Node
18.18.0, Node 22.23.2 and Bun 1.3.8: canonical identity, bigint END seek,
rename-retained inode/resize, pre-abort behavior, closed-handle errors, and
loading exactly the installed native binary. Owned handles and fixture
directories are closed/removed. This is Linux x64 coverage, not other targets
or the complete public API.

Fresh GNU numfmt comparisons pass all 16 cases with exact stdout bytes, stderr
bytes and exit status on Node 22.23.2 and the Node-hosted browser condition.
All sixteen shells are disposed in each profile. The first Bun comparison
invocation stalls without producing results and is terminated with SIGTERM
(exit 143); its failure is preserved, not counted as a pass. A resolver-only
Bun control succeeds. The cause of the larger invocation remains under
investigation at this checkpoint, so no equivalent Bun differential result is
claimed here despite its separate maintained-workflow passes.

A subsequent bounded diagnostic runs a native-only control, a stage-instrumented
driver, and one exact original-driver replay. The original replay succeeds on
Bun 1.3.8 with all 16 byte-exact comparisons and 16 disposals, preserving the
binding and installed-entry assertions. Its driver SHA-256 remains
`2c8870ebd1c18c3d1e847c7948e1604afdaa870fb826098113e11a6a34fdffc2`.
The separate result is
`out/issue-678-tmp/committed-root-numfmt-original-replay-bun-v2.json` with exit 0.
All instrumented stages complete, so they do not identify where the historical
invocation stalled. No production change or harness correction was made. The
initial exit 143 remains a failed invocation; this bounded success neither
erases it nor establishes a fixed hang or reliable repeated execution.

Evidence is under `out/issue-678-tmp/`, prefixed `committed-root-`: source
admission and build audit, pack verification, relocated consumer admission,
`utilities-*`, `native-*`, and `numfmt-*` records retain separate scopes.
Memory directory-reference semantics and version identity remain unresolved.
No remote-main delivery, publication, full utility parity, or actual browser
engine execution is established by these local checks.
