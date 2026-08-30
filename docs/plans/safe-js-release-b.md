# Release B: isolated adapter SDK and CLI configuration

## Release candidate assembly — August 30, 2026

The current candidate starts at remote main `dd7f0fcd0d7796ee17577af2a7d76da295cc5a70`,
after Foundation A (`1fede06f`, published as `12.0.3`), the independent Float32Array
release (`b16e7eeb`, `12.0.4`) and the verified documentation commit (`dd7f0fcd`).
It retains the remote engine and jobs-v7. It applies the frozen Bohr SDK, Turing
cwd/signal and Node-validation layers, the CLI/configuration projection, only the
two private FS dependency hunks, and the five-file public type-contract fix.
The existing workspace declaration rewrite remains unchanged. The type fix
narrows `FsModuleOptions` and uses `RequestInit["headers"]` in the public tiny-MCP
transport type without changing its runtime implementation.

This record supersedes the preparation-only status below for this candidate;
the original preparation evidence remains historical. Publication is not claimed
by assembly. Required verification includes isolated full gates, actual tarball
runtime/types and both CLIs, plus supported-public-route host-journal recovery
checks against the documented pending-effect contract. Browser portability,
renaming, safe-bash migration and unfinished language/class work are excluded.

## Status — August 30, 2026

Preparation only. All production CLI/config/export files remain frozen. This
phase creates baseline-relative patch evidence and this plan, not a runnable or
published release candidate. No builds, tests, package installs, production
source edits, pulls, staging/index/ref writes, commits, or pushes were performed
for this preparation. Sparse patch application is confined to evidence copies
under `/tmp`; it does not execute source code.

Release B can be independent of unfinished language/class work only if the
complete adapter SDK works with the accepted remote engine. Retain that engine's
bytes outside the explicitly approved SDK/CLI files. Keep snapshot format `1`
and `EXECUTION_SEMANTICS = "jobs-v7"`. Do not carry local `jobs-v8`, class,
ownership, browser-service, registry, interpreter, or prototype changes to make
the feature compile or pass. If a required SDK layer depends on those changes,
stop independent B and report the dependency rather than releasing partial
language work.

The accepted rename design remains conceptual in
`docs/plans/safe-js-rename.md`. B retains `packages/safejs`, `@poe-code/safejs`,
`poe-code/safejs`, and `poe-safejs`; no rename or compatibility-alias rollout is
included here. There is no public version/range selection in this plan.

## Immutable references and audit

Evidence directory: `/tmp/poe-release-b-own-prep`.

| Reference | Meaning |
| --- | --- |
| `c51139ecafcf5c8a0604788ccde914610d600d62` | Original local HEAD; unchanged by this worker. |
| `af779824231010e84f334337d3416e9658641442` | Initially observed remote main, preserving the 42 intervening commits. |
| `eccffd2fa82e9c0540a37a48d70e494ca93b1886` | Later observed remote main: the locale-aware string comparison commit on top of `af779`, not Foundation A. Its four changed engine/test files are outside the B patch. |

Both remote commits are read from immutable git objects available in
`/tmp/release-slice-a-remote-main.zI328K/source/.git`. Do not read or modify that
clone's mutable source tree while Feynman refreshes it. The original local
remote-tracking ref is not used as a freshness claim. No fetch/pull/ref refresh
was performed by this worker; `git ls-remote` supplied the observed hashes.

At the `eccffd` observation, `packages/safe-fs/src/index.ts` was still absent
from that commit. Foundation A's accepted published/remote commit remains a
separate prerequisite. The coordinator reports its 68-path application review
preserves the remote engine and differs from the older approved candidate only
in the remote-based smoke increment. Do not infer A publication or a version from
the clone, a proposed manifest, or the locale commit.

`jobs-v7-invariant.json` records identical snapshot source hashes in `af779` and
`eccffd`: `a859711f91c55699333a69c4667a91de83db2bc35d039323dffb9ffc7157c329`.
That source file is not in B's patch.

## Exact owned increment

`own-manifest.json` records each path, its exact baseline origin, before/after
SHA-256, and whether it also belongs to the cwd increment. `changed-files.txt`
lists the same scope. The five cwd files are a subset of the original 14, not
five additional files; do not apply the cwd patch again after the combined patch.

```text
packages/safe-fs/src/config.ts
packages/safe-fs/src/config.node.ts
packages/safe-fs/src/config/memory.ts
packages/safe-fs/src/config/real.ts
packages/safe-fs/src/index.ts
packages/safe-fs/tests/config.test.ts
packages/safejs/src/modules/fs-config.ts
packages/safejs/src/modules/fs-config.test.ts
packages/safejs/src/index.ts
packages/safejs/src/cli.ts
packages/safejs/src/cli.fs-config.test.ts
packages/safejs/README.md
src/cli/commands/harness.ts
src/cli/commands/harness-fs-config.test.ts
```

The exact owned patch is `owned-exact.patch`, SHA-256
`95f150361c6ac4177d14267ed25da7fc7192432c0bdc6e43d213d8d07771ff8b`.
Its reconstruction uses:

- The preserved 14-file archive at
  `/tmp/poe-fs-cwd-baseline.CNafBG/frozen-config-slice.tar`, followed by only the
  owner's `cwd.incremental.patch` to obtain final owned bytes.
- Committed `c51139` bytes for the original SDK index and two production CLIs.
  Those files had no pre-owner diff in the captured production baseline.
- The saved pre-owner README reconstructed from `c51139` plus only that file's
  captured baseline diff. Its unrelated language WIP is not an owned addition.
- The saved Foundation A index prefix, SHA-256
  `c664a7c266f34a23b4205e08fe0a4cdc381a29c5e6e0e2d4acf657edffd971ff`,
  verified against A's frozen source manifest. B appends seven export lines,
  not the foundation itself. Nine other files are owner-created additions.

Original freezes and behavioral evidence remain at
`/tmp/poe-fs-config-frozen.wpcOaX`,
`/tmp/poe-cli-fs-production-baseline.UNHTT5`, and
`/tmp/poe-fs-cwd-baseline.CNafBG`. The prior 301 focused passes and staged-contract
typecheck are not results against the newly observed remote engine.

## Applicability and mixed-file handling

| Static check | Result and qualification |
| --- | --- |
| Exact patch against reconstructed owned baseline | Applies cleanly. |
| Exact patch against bare `c51139` or `af779` | Does not apply as a complete release patch: the foundation index is absent and README context contains pre-owner filesystem integration. |
| Code-only owned patch, excluding README, against either commit plus A's frozen index prefix | Applies cleanly; this is sparse context proof, not an executable Foundation A overlay. |
| FS-only README release projections plus code against those prerequisite baselines | Apply cleanly. No local language/class prose is transplanted. |
| Same `af779` release projection against `eccffd` plus the index prerequisite | Applies cleanly. All existing owned-path baseline inputs are unchanged between these remote commits. The new locale engine/test files remain outside B. |

Artifacts:

- `c51139-release-projection.patch`, SHA-256
  `3a97ec1d2487ab3bb68a4a2fce3d441596b1ef4891feeead350545b45d57a2b3`.
- `af779-release-projection.patch`, SHA-256
  `29c8483e1bc0af69a658ed9f92e28bbee2b1fef4c79ea140b8ac217cd7eae297`.
  This same patch passed the later `eccffd` context check.
- `new-remote-proof.json`, `integration-manifest.json`, and
  `coordination-update.json` distinguish the successive observations and gates.

These projections are **not** whole-file copies from the dirty checkout. For
the standalone CLI, applying the remote CLI increment after the owned increment
produces exactly the same bytes as applying the owned increment to the remote
CLI. `remote-cli-preserved.patch` records the remote `maskSource`/source-offset
fix; the commutativity check proves it was not overwritten.

README requires a release-specific projection: apply owned FS/config/cwd
paragraphs to the committed README, preserve its unrelated language text, and
explicitly distinguish native-Node parity from shared-adapter behavior. The
projection is a review artifact, not permission to rewrite the frozen README.
Its temporary compliance wording must be reconciled with Turing's newly
authorized error-contract paragraph when that increment freezes. Do not copy
either worker's entire mixed README or use a context-failure force apply.

## Required layers outside the 14-file owner patch

### A. Foundation A prerequisite

Require the accepted actual remote/published foundation commit and its canonical
`poe-code/safe-fs` runtime/declaration graph. Keep root A manifest, lock, bundle,
lint, smoke, provenance, and foundation-source changes out of the B owner patch.
The saved index-prefix overlay proves context only. It is not a substitute for
checking the complete final A graph and APIs after A lands.

### B. Bohr's base adapter SDK increment — receipt pending

Released `FsModuleOptions` on the observed remote still has `root` and `fs`, not
`adapter`, `cwd`, or `signal`. The config helper therefore cannot ship alone.
Require Bohr's frozen **SDK-only baseline-relative** adapter increment against
the accepted released engine, not a cwd-only delta atop uncommitted integration.

Turing's required input hashes are:

| Path | Captured base SHA-256 |
| --- | --- |
| `packages/safejs/src/modules/fs.ts` | `ee95c5a3cec10ff2953d862c53354d0e3b97fc2200d3e1cfe39d98da73640ff8` |
| `packages/safejs/src/modules/fs.adapters.test.ts` | `ff8aa247e319f4333b09e0acf5c86a80c58a965f5d34bad83f8e7939815d8622` |

Static comparison finds that captured `modules/canonical-path.ts` and
`error-codes.ts` are byte-identical to the observed remote versions. They need
no overlay based on this evidence. Captured `interp/host-bridge.ts` differs:
retain the remote file, never overlay the captured one. Its existing
`declareHostOperation(operation, policy, options?)` API matches the form used by
the captured fs binding, but actual compatibility still requires the final
remote-engine tests. This observation is not a type/runtime proof or permission
to change host-bridge internals.

No author-frozen base SDK patch has been combined into the evidence candidate
yet. Do not substitute Bohr's broader platform-services/browser increment.

### C. Turing's frozen cwd/signal increment

Source receipt:
`/tmp/safejs-fs-cwd-implementation.1IkAop/incremental-against-bohr-baseline.patch`
and `final-audit.json`. The copied `turing-cwd-signal.patch` has SHA-256
`6b26ba31902722663b2d6e72fc8263c46c44a7d474d36f9a1c145d6bcc50ccce`.

The patch is verified against its two captured base files, and sparse replay
reproduces both author final hashes. Direct application to the remote fails,
as expected, because the base adapter integration/test file is absent. It is
recorded as a separate ordered layer, not incorrectly concatenated into a
remote-ready all-in patch.

Turing reports 52 adapter passes on Node 18.18.2/20.20.0/22.22.2/24.14.0 and
605 focused passes on 20/22/24 with an older frozen engine. These are attributed
author results, not this preparation's execution or final B acceptance.

### D. Turing's error-contract/tests increment — receipt pending

The coordinator authorizes narrow `packages/safejs/src/modules/fs.test.ts`
changes and **one** README FS error-contract paragraph, not production validation
changes. The contract is stable Node-style error code/class and informative
diagnostics, not native-version-specific exact wording. Do not reproduce the
uncoded Node 18 `mkdtemp` NUL bug. Correct the invalid `ENOENT` expectation to
`ERR_OUT_OF_RANGE` where the frozen test increment establishes it.

Keep that author's baseline-relative patch separate until freeze. Preserve this
worker's config paragraphs; reconcile the one error paragraph with the release
README projection instead of importing the entire README or existing fs-test
WIP. The previous ten Node 18 failures are diagnostic history, not a waiver for
the new acceptance contract. Final acceptance requires **all five** coordinator
Node versions. The earlier cwd receipt lists only four exact versions; require
the five-version receipt rather than inferring a fifth from installed binaries.

### E. Necessary private dependency metadata

`private-dependency-proposal.patch` contains exactly two one-line additions:

1. `packages/safejs/package.json`:
   `dependencies["@poe-code/safe-fs"] = "*"`.
2. `package-lock.json`:
   `packages["packages/safejs"].dependencies["@poe-code/safe-fs"] = "*"`.

The star is the existing private-workspace dependency convention, not a guessed
public package version/range. Root A already supplies its own safe-fs workspace
link/dependency/package record; B must not reapply or replace those root hunks.
Do not edit root versions, public ranges, `safe-bash`, or unrelated lock records.

Proposal SHA-256:
`8b4c81890da979f79ce710298b827c14f89429c9a218e2916dd9079b650d9a8e`.
The lock proposal is based on the previously captured, hash-verified A lock
artifact (`foundation-lock-captured.json`), not a subsequent mutable clone-tree
read. Recheck the two field additions against the actual final A commit; if
already present with the intended value they become no-ops, otherwise review
any difference rather than replacing the lockfile.

The currently known minimal union is 18 paths: 14 owned, two Turing SDK paths,
and two dependency paths. It is not a final release count: the base receipt,
fs-test followup, and verification-file scopes must be reconciled first. README
is already one of the 14 and must never acquire two concurrent writers.

## SDK public exports and installed-type acceptance

No new root export path is needed for B; retain `poe-code/safejs` and
`poe-code/safe-fs` and their accepted A targets. Required additive exports:

| Entry | Required names |
| --- | --- |
| SafeJS Node SDK | Values `parseFsConfig`, `resolveFsConfig`; types `FsConfig`, `ResolveFsConfigOptions`. Existing `makeFsModule` and exported `FsModuleOptions` must expose the full approved adapter/root/cwd/host-signal contract. |
| safe-fs Node entry | Values `createFileSystem`, `readConfigRecord`, `validateFileSystemConfig`, `createNodeFileSystemAdapterRegistry`; types `FileSystemConfig`, `FileSystemAdapterDescriptor`, `FileSystemAdapterRegistry`. |

`core` must not acquire Node filesystem/CLI imports. Generic safe-fs config
retains explicit-registry injection and no static Node defaults; Node defaults
remain separate. JSON allows `adapter`, optional absolute virtual `root`, and
optional absolute virtual `cwd`, preserving omission and rejecting `signal`.
`signal` remains a borrowed host capability passed directly to `makeFsModule`.

### Strict declarations: reuse the existing mechanism

The new source-level declarations refer to the private `@poe-code/safe-fs`
workspace. The observed remote `scripts/bundle.mjs` already runs
`rewriteWorkspaceDts` recursively for every workspace dist and derives relative
declaration targets from workspace manifests. A's reviewed bundle increment
retains that mechanism. It should rewrite the new `modules/fs.d.ts` and
`modules/fs-config.d.ts` references into the one packed safe-fs declaration tree.
Do not invent another type facade, dual registry, discovery framework, or public
dependency to mask a failed rewrite. This is a static expectation, not a passing
installed-type result; the gate below is mandatory.

### Cases to add or extend after scope authorization

- **Public export behavior:** extend the owned SDK-helper test or add one bounded
  public-FS-config test, not the entire mixed `src/index.test.ts` from the dirty
  tree. Assert both SDK functions exist and retain implementation identity.
  Check new safe-fs values/types without requiring unsupported exports on core.
- **Installed runtime:** extend the accepted remote/A `scripts/smoke-test.ts`
  incrementally. Import from public `poe-code/safejs` and `poe-code/safe-fs`,
  construct a memory adapter, pass it through `makeFsModule`, write/read from a
  real remote-engine run, and verify shared state and canonical filesystem error
  identity. Exercise root/cwd separation, omitted cwd, extension validation,
  duplicate rejection, and host cancellation without an implicit JSON signal.
- **Installed types:** use the existing strict smoke compiler pattern with both
  NodeNext and Bundler resolution, `strict: true`, `noEmit: true`, and
  `skipLibCheck: false`. Resolve real installed package exports, not workspace
  aliases, private links, source paths, `any`, or casts that hide incompatibility.
  Require `FileSystem`, `FileSystemFactory`, descriptor/registry/config types,
  SDK `FsConfig`, `ResolveFsConfigOptions`, and `FsModuleOptions` to compose.
  `await resolveFsConfig(config, { registry })` must be assignable to the module
  options and retain typed `cwd`; an added host `AbortSignal` must be accepted by
  `makeFsModule`. Negative type cases reject JSON `signal` and unknown resolution
  option keys; runtime tests reject simultaneous legacy `fs` and `adapter`.
- **Declaration closure:** inspect packed `index.d.ts`, `modules/fs.d.ts`,
  `modules/fs-config.d.ts`, and the safe-fs config/contracts declaration tree.
  No unresolved private specifier or missing transitive declaration may be
  hidden by devDependencies or `skipLibCheck`. Preserve same-realm constructor and
  authority identity in the canonical A runtime graph.
- **Metadata:** add narrow checks to the accepted remote version of
  `tests/integration/standalone-package-metadata.test.ts` for the private SDK
  dependency and unchanged public export/bin targets. Do not take a whole local
  metadata/smoke file containing prior language assertions or root A work.
- **CLI behavior:** run both existing focused CLI suites and the owned config
  tests against the actual accepted remote-engine candidate. Preserve the remote
  Markdown/source-offset fixes, legacy host roots/worktree mapping, config
  validation-before-I/O, and opaque adapter forwarding. No config backend cases
  in the CLIs and no extra cwd CLI flag.
- **Five-version contract:** run the approved narrow native-validation/adapter/
  SDK/config cases and installed consumer checks on the exact five-version
  matrix recorded by the coordinator/Turing followup. Verify code/class and
  informative diagnostics; do not weaken confinement or emulate uncoded native
  bugs to satisfy version-specific message snapshots.

## Integration order and stop conditions

1. Obtain the actual accepted A remote commit and preserve every intervening
   remote commit, including `eccffd` or later changes. Read pinned git objects,
   not Feynman's live worktree. Refresh applicability evidence without changing
   the original repository's refs/index or importing dirty source.
2. Receive Bohr's SDK-only base freeze. Check its exact released baseline and
   output hashes before adding Turing's frozen two-file increment. If a rebase
   changes expected hashes, obtain a reviewed new increment rather than forcing
   it onto incompatible code.
3. Receive Turing's narrow error-contract/tests freeze. Assign one README
   integration writer to compose that paragraph with the FS-only config
   projection; keep all class/language prose excluded.
4. Apply the owned 14-file release projection and the two private dependency
   additions in an independently authorized immutable candidate. Retain the
   actual remote host bridge, runtime, registry, snapshot semantics, and language
   implementation. No broad source-directory copying or cleanup.
5. After explicit execution/build/install authorization, add the bounded public
   export/type checks and run the exact five-version matrix on that candidate.
   Earlier c511-derived frozen-fixture results do not satisfy this gate. No
   final SDK or package acceptance is claimed from static patch application.
6. Stop if any required SDK dependency would bring in unfinished local engine
   work, if `jobs-v7` changes, if declaration resolution needs hidden private
   packages, or if the approved diagnostic/confinement behavior fails. Report
   the minimal dependency instead of silently expanding the release.

No release version, commit, push, publication, or alias-removal decision is
authorized here. Permanent QA conclusions belong in this plan; ad hoc evidence
and scripts remain under `/tmp`, not in the repository. Preserve the original
dirty checkout and all previous freeze evidence throughout.
