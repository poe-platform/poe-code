# Shared safe-fs adapters and safe-js rename

Status: The Node foundation (A, `poe-code@12.0.3`) and explicit SafeJS Node SDK/CLI
integration (B, `poe-code@12.0.5`) and filesystem-only browser profile
(C, `poe-code@12.0.7`) are published and verified. C passed full candidate and
fresh published-artifact gates. Cross-repository migration and full browser
SafeJS/safe-bash execution remain incomplete. The canonical rename is implemented
in an isolated candidate; its release gates and publication are tracked in
`safe-js-rename.md`. Published C now also has bounded Chromium, Firefox and
Playwright WebKit filesystem verification; it does not establish browser SDK support.

## Incremental release record — A (August 30, 2026)

- Published version: `poe-code@12.0.3`, public Node entry `poe-code/safe-fs`;
  `@poe-code/safe-fs` remains a private workspace identity, not a public import.
- Commit and registry `gitHead`: `1fede06f0956d5133b3e94eb4508f3e710c7d156`.
  GitHub release run [`33294235871`](https://github.com/poe-platform/poe-code/actions/runs/33294235871)
  succeeded; downloaded registry tarball integrity and provenance were verified.
- The 68-path release preserved the remote baseline's SafeJS work and excluded
  incomplete original-checkout integration/class/language changes. Foundation
  provenance covers 51 files and 31 upstream records: 17 of 23 adapter files are
  byte-identical and six transformed. These are release A counts, not a claim
  that later browser-portability files were shipped.
- Fresh published runtime/adapters/shared authority and error identity, real
  temporary-directory integration, public CLI, and strict NodeNext/Bundler types
  passed on Node 18.18.2, 22.22.2 and 24.14.0. One canonical FS runtime and all 35
  published foundation declarations match the verified candidate bytes.
- Candidate full suite: 26,266 passed and 41 existing skips, with no new hidden
  exclusions; 136 FS-focused tests passed per Node version. Normal commit/push
  hooks, the complete GitHub workflow, and published-artifact checks passed.
- At A, whole-package browser support remained pending: the public root rejected
  an unshimmed browser build on 11 Node built-ins. Helper-only Chrome evidence did
  not establish whole-package support. SafeJS SDK/CLI adapter integration,
  SafeJS/safe-bash runtime migration, the rename and language/class work were
  separate, incomplete work; the later records distinguish delivered milestones.
- This A record did not authorize B; its then-pending private-declaration and
  candidate gates were subsequently completed as recorded below.

## Incremental release record — B (August 30, 2026)

- Published version: `poe-code@12.0.5`; commit and registry `gitHead`
  `860467821d390fab7da8095de9f7fec8b43055de`; GitHub run `33297073653` succeeded.
  Publication receipt: `/tmp/release-b-published.lQ2qcu/RECEIPT.md`.
- The 26-path slice ships explicit Node adapter injection, independent virtual
  `cwd`/confinement and borrowed cancellation, SDK filesystem configuration and
  both CLIs. Node-mode defaults and Node >=18.18 support remain unchanged.
- The full candidate passed 26,497 tests with 41 existing skips. Each of Node
  18.18.2, 18.20.8, 20.20.0, 22.22.2 and 24.14.0 passed 882 focused tests; fresh
  published runtime, recovery, both CLIs and strict installed types passed.
  Public index/core/CLI recovery retains host-call metadata without a metadata
  routing rewrite or a universal exactly-once guarantee.
- Nested workspace declaration imports are rewritten to canonical relative Node
  declarations. Their installed NodeNext/Bundler proof is valid for B, not proof
  that the SDK graph will follow future browser export conditions.
- B's documentation successor is `8bdd30a7c804e646fdf2c569bc6bdabd408f301c`.
  C documentation preserves that committed Node contract, not mutable working-tree
  README or unrelated language/rename work.

## Incremental release record — C (August 30, 2026)

- Published version: `poe-code@12.0.7`; commit and registry `gitHead`:
  `a21b09b450739d2ccfc44a1a17770fd86785d7e4`. GitHub release run
  [`33300282777`](https://github.com/poe-platform/poe-code/actions/runs/33300282777)
  succeeded with that exact checkout. Registry tarball integrity was verified.
- The exact 63-path slice preserves remote baseline
  `0750017f6fa71054a4b5cf6e4961139a01788b9d`, including its Map/Set callback
  mutation work, prior Float32/jobs-v7 changes and unrelated remote source.
  No live original-checkout browser, class or language work was overlaid.
- Full candidate suite: 26,674 passed, 41 existing skips, no new exclusions.
  Each of Node 18.18.2, 18.20.8, 20.20.0, 22.22.2 and 24.14.0 passed 1,432
  focused tests. Normal commit/push hooks and the complete release workflow passed.
- Fresh published runtime, adapter authority/error identity, recovery, both CLIs,
  actual temporary-directory integration and strict consumer types passed on
  all five Nodes. Node-only/DOM consumers passed NodeNext/Bundler, including
  separate `@types/node` 18.19.130, 20.19.43, 22.20.1 and 24.13.3 consumers and
  nine rejected option unions per mode. S3/WebDAV checks used explicit mock or
  injected transports, not deployed cloud services.
- All 141 canonical JavaScript files and 51 FS declarations match the candidate,
  registry tarball and fresh install. All 17 package-lint rules and 17 negative
  publication controls passed; there is no second tsc-emitted FS runtime.
- Actual Chromium 149.0.7827.55 passed 17 supported public portable-FS checks
  with zero Node externals or globals. The named host/SafeJS browser routes are
  denied as documented below. This does not verify Firefox, WebKit or a browser
  SafeJS SDK/runtime; those gates remain pending.
- A two-file compiler-loading correction keeps pure package policy usable
  without TypeScript and loads the compiler only in the async declaration
  collector. Strict production-only install red/green proof and 208 package-lint
  tests passed; actual collection still rejects a missing compiler. No dependency,
  lock or FS change was needed for that correction.
- Declared FS recovery retains fail-closed uncertain mutation handling and
  accepted reconciled/recorded replay without a universal exactly-once claim.
  Erdos's separate published-B finding for raw untagged functions using only
  `registerPendingHostCallPolicy` remains an unresolved contract question; C
  neither fixes nor waives it.
- Original HEAD/index, four terminal fonts and the CLAUDE.md symlink were
  preserved. Authoritative receipt:
  `/tmp/release-c-published.lZsBvR/artifacts/final-receipt.json`.

## Supplemental published C cross-browser record — August 30, 2026

After the C docs commit `49eea61131a83e2713c5b7ca3b198631bef7be4c` was frozen,
the same integrity-verified `12.0.7` registry artifact passed 17 public FS checks
per page and module worker on Chromium 149.0.7827.55, Firefox 150.0.2 and
Playwright WebKit 26.4: 102 checks, 11 negative browser-graph cases and 20 strict
browser type profiles. This supplements the earlier Chromium-only record; it
is not Safari certification or a renamed-artifact verification. Evidence:
`/tmp/published-c-crossbrowser.jzgMlR/REPORT.md` and `final-audit.json`.

The separate frozen, unreleased guest-codec/confinement probes do not establish
published SDK coverage and are excluded from those counts. Full browser
SafeJS/runtime integration remains pending. The registration-only host-policy
contract issue is genuine and assigned to a separate follow-up; its unfinished
fix is not included in this rename.

## C milestone — portable filesystem only

The following contract is published and verified in `poe-code@12.0.7`.
Public browser runtime targets and declarations agree:

| Route | Node/default | Browser |
| --- | --- | --- |
| `poe-code/safe-fs` | Existing complete Node surface | Portable core |
| `poe-code/safe-fs/core` | Core with Node platform policy | Same portable graph as browser root |
| `poe-code/safe-fs/node` | Same complete Node host surface as root | Runtime denied; empty declarations |
| `poe-code/safejs` | Existing Node SDK | Runtime denied; empty declarations |
| `poe-code/safejs/core` | Existing Node core | Runtime denied; empty declarations |
| `poe-code/safejs/cli` | Existing Node CLI | Runtime denied; empty declarations |

These are exact routes, not a broad SDK removal or new aliases. No other public
export is changed. Mixed unsupported Node SDK/browser FS imports fail resolution,
not later constructor/authority checks. Node root/core/node and the Node SafeJS
entries share one split graph; browser FS root/core share one portable split
graph. Identity is guaranteed within one installed graph/realm/condition, not
across duplicate installations, independent bundles, workers or mixed profiles.

Portable core exposes byte contracts, virtual paths, errors, memory, readonly,
mount, overlay, WebDAV, `compareEntries`, and `createFsBridge`. Real host storage,
Node bridge/path helpers, S3/transports and B's configuration registry/helpers
stay Node-only. `createFsBridge(adapter, {codec, cwd?, signal?})` requires an
explicit trusted codec and returns owned Uint8Array results; the Node bridge
retains genuine Buffer behavior through the shared 21-operation implementation.
Virtual `cwd` defaults to `/` and is the bridge confinement boundary as well as
the relative-path base. Absolute paths preserve backing virtual meaning and
must lie within that boundary; parent traversal cannot leave and re-enter it.
Restricted bridges inspect symlinks component-by-component and reconcile the
original operand or existing parent with the adapter's actual canonical result.
Missing ancestors outside the boundary cannot be created. Absolute symlink
creation is refused with `ENOTSUP` under confinement after cancellation and
lexical boundary checks; use a checked relative target without rewriting its
stored text. Whole-namespace defaults retain their absolute-target behavior,
and existing absolute links require actual canonical verification before use.
Missing or unsupported metadata fails closed. The path-based adapter
contract does not supply race-proof host directory-handle confinement. Signals are borrowed,
composed and never aborted by the library. C adds no environment variables or
codec dependency; safe-fs has zero external runtime dependencies, but installing
the parent poe-code distribution is not a zero-dependency installation.

The single `FsError` class uses immutable condition-selected platform policy:
Node retains numeric errno; browser `errno` is present but undefined, typed
`number | undefined`. Symbolic `code` is authoritative. Browser comparison uses
registered built-in authority; a needed custom comparison rejects with `ENOTSUP`
before callback invocation, without upgrading unknown identity. WebDAV rejects a
custom comparison option at construction under browser policy. Secure browser
entropy is required for overlay staging and portable `mkdtemp`, using Web Crypto
UUID or random bytes, never `Math.random`; missing capability yields `ENOTSUP`
before staged publication, not a promise of zero preceding reads/probes.

Actual emitted declaration routing includes private `#safe-fs-platform` type
leaves and public core/node profiles. Existing hard-relative Node SDK imports
bypass root export conditions: changing conditional exports alone cannot make
that declaration graph portable. C preserves B's Node rewriting and denies the
three still-Node-only SDK browser routes. A future browser SDK needs its own
profile-aware declaration graph plus owned execution/host-call metadata and the
portable guest facade. No FS-only result claims those runtime gates have passed.

Frozen proof: `/tmp/safe-fs-c86-denial.xBrLNK/FEYNMAN-HANDOFF.md` and
`final-audit.json` record 45 foundation inputs plus 15 packaging paths against B's
docs successor. The composed pack has 51 FS declarations and no second tsc FS
JavaScript runtime. It passes all 17 package-lint rules and 17 negative publication
controls, strict installed NodeNext/Bundler under four type profiles, 269 focused
tests on each of five Node versions, and 17 Chromium checks with zero Node
externals/globals. Original duplicate-bundle and unsupported-SDK red evidence is
retained. That owner proof reused verified B noncanonical output and was **not a
full candidate build**. The C release record above adds the fresh full build,
complete gates and actual published-artifact verification, including the bounded
compiler-loading correction. Package README and this plan were applied as a
separate two-path docs increment, not foundation-source replacement. Future
OWN/guest SDK packaging, browser shell and actual safe-bash
migration/removal remain separately gated; no live author tree is overwritten.

## Exact requirement

> extract safe-bash fs adapters into safe-fs, rename safejs to safe-js and add ability to use the same filesystem adaptors for safe-js and safe-bash, one of them should be just plain directory on the machine, plus we will be adding more

Additional user requirement:

> it should also run in browser btw, when built properly; keep making commits and pushing new releases of poe-code

This plan supplements `safejs-language-completeness.md`. All language requirements,
unchecked work, and validation/release gates in that goal remain in force.
Browser support adds a delivery target; it does not authorize a smaller JavaScript
engine, weaker snapshot validation, or a reduced language-completeness goal.

## Starting facts and boundaries

- This repository currently contains `packages/safejs`.
- `/Users/kjopek/Workspace/safe-bash` is a separate repository whose package is
  currently named `virtual-bash`, private and unpublished. It already has memory,
  real, S3, and WebDAV implementations and mount, overlay, and readonly wrappers.
- Canonical placement is `packages/safe-fs` in poe-code; its public distribution
  entry is `poe-code/safe-fs`. `@poe-code/safe-fs` is the workspace package identity,
  not an additional promised standalone release. Ship runtime code and public
  declarations through poe-code, and migrate sibling consumers to that supported
  distribution. Do not infer a published safe-bash package from its name.
- Audit migration explicitly; do not invent compatibility aliases or guarantees.
  Public aliases remain undecided, not an extra requirement. Preserve every
  unrelated working-tree change throughout implementation.
- README updates and "push commits as you go" are already explicitly authorized:
  update README as behavior is verified; commit and push atomic completed items
  with hooks enabled, and monitor each GitHub release to success.

## Inspected contract

Read-only review of `/Users/kjopek/Workspace/safe-bash` found the following existing
contracts. Extraction sources now exist under `packages/safe-fs`; the sibling's
copies and consumer migration remain a separate deletion gate. These facts do not
establish a completed rename, browser port, or release.

- `src/contracts/filesystem.ts` defines a structural, byte-oriented `FileSystem`
  using `Uint8Array`, capability flags, and optional operations. `FileSystemFactory`
  accepts an options record and returns a filesystem or a promise of one.
- `src/fs` contains memory, real, S3, WebDAV, mount, overlay, and readonly
  implementations. Shared authority registries include mount comparison/entry-view
  registration and S3 authority tracking. Extract these together, preserving
  `FsError` identity and shared registries rather than duplicating adapters.
- `src/fs/real/index.ts` already exposes `RealFileSystem({root})` and
  `createRealFileSystem` for a machine directory. The root must already exist and
  be an absolute path on a POSIX host. Path/symlink checks are not atomic with
  host operations: this is not race-proof OS isolation against concurrent tree
  modification. Keep that limitation explicit in confinement tests and README.
- `src/integrations/safejs/filesystem.ts` already provides
  `createNodeFsBridge(fs, {cwd?, signal?})`, adapting the filesystem to a Node
  `fs/promises` subset. Its existing `makeSafeJsFsModule` passes that bridge to
  `makeFsModule`. The shared package now owns the bridge; migrate the consumer to
  SafeJS's explicit `adapter` option rather than retaining a second implementation
  or treating synthesized bridge inode fields as confinement authority.
- Preserve existing storage metadata protocols during extraction and rename,
  including S3 `virtual-bash-mode` metadata and directory markers. A public-name
  audit must not silently rewrite persisted storage formats.
- Continue or move `tests/fs/conformance`, backend conformance tests, and
  `tests/integrations/safejs` with the extracted code and consumers. Disk-fixture
  checks remain integration tests; use memfs for unit tests. Add failing shared
  contract and cross-runtime regressions before implementation.

## Runtime and packaging constraints

- `packages/safejs/src/modules/fs.ts` exposes Node mode
  `makeFsModule({root?, fs?})` and adapter mode
  `makeFsModule({adapter, root?, cwd?, signal?})`. Simultaneous `fs` and `adapter`
  reject, as do `cwd`/`signal` without an adapter. Node-backed defaults and
  host-relative roots remain unchanged. Adapter `cwd` must be absolute virtual;
  it defaults to the adapter root when rooted, otherwise `/`. With explicit
  `root`, cwd remains an independent relative-path base beneath the existing
  root wrapper; without root, cwd itself confines the bridge. Adapter-backed
  explicit roots also refuse absolute symlink creation and recursive mkdir that
  would create a missing outside ancestor. Relative roots start at virtual `/`. JSON config
  permits optional absolute virtual `cwd`; a host signal is SDK-only, not JSON.
  Adapter aliases require authoritative
  comparison, not the Node bridge's synthesized `dev`/`ino` fields. SafeJS owns
  guest conversions and host-call replay policy. This module remains Node-only.
- A private workspace-only safe-fs does not itself distribute the dependency to
  standalone `virtual-bash`. Public `.d.ts` dependencies must ship too; a sibling
  `file:` dependency is not a release contract. The selected distribution is
  `poe-code/safe-fs`; packed public-consumer tests must prove constructor identity,
  shared registries, and declaration resolution before deleting sibling sources.
- The rename audit includes `package.json` exports, `scripts/bundle.mjs`, smoke
  and consumer tests, and `SKILL_` templates followed by `npm run sync-skills`.
  Avoid duplicated old/new runtime bundles: module-local `WeakMap` registries and
  identity-sensitive objects must not split across runtime copies. This does not
  require public aliases.

## Browser boundary: pre-C observations

This audit records the pre-C baseline. C supersedes the shared-FS Node dependency
findings with its conditional portable graph, but does not establish browser
SafeJS/shell support. A lightweight export or memory backend alone is not browser
evidence; the full-runtime requirements below remain open.

- `packages/safejs/src/core.ts` exports `run`, `lint`, `Budget`, and resumable
  randomness. Its graph still reaches `node:async_hooks` through `interp/jobs.ts`,
  `cancel.ts`, `promise-replay.ts`, `promise-tracker.ts`, and `resources.ts`.
  `interp/host-call.ts` and `random.ts` use Node crypto. `snapshot/scheduler.ts`
  eagerly imports the file backend, bringing in Node crypto, filesystem, and path
  APIs even when the caller supplies no snapshot path. `snapshot/serialize.ts`
  and `snapshot/validation.ts` use Node-native type checks and deep equality.
- The broad SafeJS `src/index.ts` also exports filesystem, process/agent, Git,
  MCP transport, harness loading, and file migration facilities. The new
  `modules/fs.ts` import of the shared root exposes the whole Node-backed safe-fs
  export graph to resolution. Neither root currently separates browser capability
  code from Node integration code.
- Safe-fs's structural `FileSystem` is byte-oriented and suitable for browser
  implementations, but its runtime graph is not portable yet. The memory entry
  reaches Node errno lookup through `contracts/errors.ts`, and async-local
  comparison/authority through `fs/mount/comparison.ts` and `fs/s3/authority.ts`.
  `contracts/path.ts` imports `node:path`; overlay IDs use Node crypto. The broad
  root additionally includes the real backend, Node bridge, and Node transports.
- The sibling's `src/shell/index.ts` is not a browser entry either. Contracts
  import `node:util`, `node:path`, and `node:stream/web`; shell byte operations use
  `Buffer`. The shell graph reaches the bounded ERE engine's Node worker transport
  and timers. The package's inspected exports have no separate public shell/core
  or browser entry; its root also exports command families and the real backend.
  Replacing the shell parser or removing its language features is not a solution.

Evidence is in `/tmp/safejs-browser-boundary.X7bMY9/bundle-proof.json`,
`bundle-proof.log`, and `copied-source-manifest.json`. Esbuild 0.28.1 was run only
against copied sources with `platform: "browser"`, `format: "esm"`, no Node
externalization, no shims, and no runtime execution. All nine probed entries fail:
SafeJS core/root/fs module, shared FS root/memory/contracts, and sibling
root/shell/contracts. The narrow SafeJS core has 12 unresolved Node imports,
shared memory has three, and sibling shell has six. The broad SafeJS root also
reports workspace dependencies deliberately absent from the isolated copy;
those additional errors are not counted as proof of Node-only behavior.

The safe-fs probe uses the frozen extraction artifact at
`/tmp/safe-fs-extraction.Z2Isqy/package/dist`, before the concurrent signal fixes;
it is not a certification of another author's active edits. No live build,
browser session, package install, or browser acceptance test was run. The prior
Node integration evidence is separate:
`/tmp/safejs-fs-adapters.BugvEu/final-audit.json` records 576 focused tests, including
23 adapter regressions. Those passing Node tests do not establish browser support.

## Minimal browser architecture

### Entry and capability separation

Keep one interpreter, one shell implementation, and one shared filesystem
contract. Split environment wiring, not language execution. The minimum entry
layout below is a required implementation target, not a claim that the subpaths
already exist:

- `poe-code/safe-fs` remains the canonical distribution. Add a portable
  `poe-code/safe-fs/core` entry for contracts, errors, virtual paths, memory, and
  portable wrappers; keep `poe-code/safe-fs/node` for the machine-directory
  adapter, Node-shaped bridge, and Node-only transports. The canonical root's
  browser condition selects the portable entry; its Node condition preserves the
  promised Node exports. Explicit subpaths allow deterministic selection. Use
  re-exports of common modules rather than a second copy of the classes.
- The safe-js rename must provide a portable `poe-code/safe-js/core` entry for
  parsing/linting, running, budgets, dump/restore, and the implemented language
  semantics. A planned `poe-code/safe-js/browser` facade re-exports that core and
  provides `makeFsModule({adapter: FileSystem, root?})`, with a required adapter and
  no Node-shaped `fs` injection or ambient fallback. The canonical root's browser
  condition selects this facade. The Node facade retains existing Node filesystem
  defaults, CLI/harness loading,
  file snapshot convenience, process modules, and Node transports. Public naming
  and migration tests must distinguish proposed browser subpaths from existing
  `poe-code/safejs` paths; compatibility aliases are not assumed.
- Safe-bash needs an exported portable shell/registry entry, not just an internal
  `src/shell/index.ts` import. It must consume the canonical shared filesystem
  implementation and isolate Node command/transport capabilities from that entry.
  Browser-reachable regex execution needs a Web Worker transport with the existing
  bounded protocol, not a fallback to unbounded native regular expressions.
- Export conditions select these environment facades, but a `browser` field,
  `platform: "browser"`, or changing the output to ESM is insufficient while
  portable entries import Node services. Do not externalize Node builtins or
  replace `fs`, async context, validation, or process modules with empty shims to
  make the build appear successful. Browser `.d.ts` graphs must also be free of
  required `NodeJS`, `Buffer`, private workspace, and Node builtin references.
- The same adapter instance can serve both runtimes within one browser realm.
  Co-locate them in a dedicated worker when worker isolation is used. A UI and a
  separate worker do not share a JavaScript object merely by cloning it; any
  cross-realm filesystem service needs explicit capability-scoped transport and
  must not claim same-instance identity. Keep error constructors and authority
  registries single-instanced within each consumer realm.

`RealFileSystem({root})` remains a Node-only adapter for an existing configured
host directory. It does not work in a browser by changing bundler settings, and
virtual `/` is not access to the machine's root directory. Memory plus its portable
wrappers is the initial browser filesystem target. OPFS or user-selected directory
handles can later implement the same structural `FileSystem`; they are distinct
browser backends with explicit capabilities, not a browser version of Node's real
adapter and not an additional claimed implementation in this checkpoint.

Browser execution grants no ambient process, filesystem, network, or host code
evaluation. Optional browser network transports require explicit configuration
and browser authorization/CORS handling. Keep Node backend options out of browser
facades rather than silently ignoring them. Existing CLI `--fs`/`--fs-root`
host-path semantics remain unchanged until their separately tested migration.

### Runtime work that packaging cannot replace

1. **Execution context:** propagate a run-owned context through interpreter jobs,
   await continuations, host callbacks, cancellation, promise tracking, and
   resource cleanup. Node async-local services may remain behind Node wiring, but
   browser execution must not substitute a module-global current-run stack or
   monkey-patch native promises. Concurrent and reentrant runs must retain their
   own budgets, cancellation provenance, job ownership, and replay state.
2. **Crypto and checkpoint data:** retain the current canonical host-call and
   migration SHA-256 digests, seeds, and snapshot markers. Supply portable entropy
   and UUID services and a digest implementation matching the existing bytes.
   Existing synchronous digest call sites cannot silently become asynchronous:
   Web Crypto digest returns a promise. Keep `parse/hash.ts`'s existing portable
   AST hash unchanged. File-backed snapshot creation belongs in Node wiring;
   portable execution accepts the structural `SnapshotBackend` without importing
   `FileSnapshotBackend` through its scheduler.
3. **Validation:** replace Node deep equality only for the already validated data
   domain, retaining all graph/identity checks. Native `types.isProxy` and
   `types.isPromise` cannot be replaced by duck typing or property probes that
   invoke host accessors. Portable owned-value branding and checkpoint ingress
   must preserve refusal/security behavior. Trap-free rejection of arbitrary
   hostile host objects is an unresolved boundary, not an exemption or permission
   to delete checks. A tested ingress design is a browser-release blocker.
4. **Filesystem portability:** remove Node path/errno/async-context dependencies
   from the shared portable closure while preserving `FsError` identity, existing
   Node error fields, alias authority, readonly behavior, and storage protocols.
   Keep native errno lookup and Node buffer/stat adaptation at Node boundaries;
   document the portable error representation without silently changing the
   existing public error contract. The browser guest FS facade must use shared
   adapter operations and portable byte/codecs, not the existing Node bridge or
   a second backend implementation. Extract common operation semantics once if
   both facades need them; retain supported encoding/options behavior explicitly.

### Smallest implementation write scopes

These are future ownership scopes, not permission for this documentation worker
to edit runtime files. Obtain the active owners' frozen checkpoints first.

1. **Portable shared FS:**
   `packages/safe-fs/src/contracts/{errors,path,io,index}.ts`, new portable
   entry/platform helpers, memory/wrapper import edges, comparison and authority
   context internals plus direct callers. Gate: memory/contracts/wrappers bundle
   without Node; concurrent comparisons, unknown identity, errors, aliases, and
   readonly tests remain correct.
2. **Node FS separation:** shared package `src/node/*`, real/Node-transport entry
   exports, and Node errno wiring; portable operation helpers only where needed
   to avoid duplication. Gate: Node adapter and existing bridge conformance stay
   unchanged, and machine-directory code is unreachable from portable entries.
3. **Portable interpreter services:** SafeJS `random.ts`, `interp/host-call.ts`,
   `migrate.ts`, `snapshot/{backend,scheduler,serialize,validation}.ts`, and new
   portable service/Node wiring files. Gate: digest/snapshot compatibility and
   validation refusals match; an in-memory checkpoint run has no file-backend
   import.
4. **Owned execution context:** SafeJS
   `interp/{jobs,cancel,promise-replay,promise-tracker,resources}.ts`, `run.ts`, and
   the continuation/host-callback call sites using those stores. Gate: concurrent
   runs, suspended generators, callback reentry, cancellation, cleanup, and restore
   preserve ownership. This is not a five-file import substitution.
5. **Portable guest FS and public engine entries:** SafeJS `core.ts`, `index.ts`,
   `modules/{fs,canonical-path}.ts`, shared guest conversion/adapter-only facade
   files, and focused tests. Gate: the same implemented engine and guest operation
   policies work in browser; default Node API/root behavior stays unchanged.
6. **Sibling shell boundary:** separate-repository
   `src/contracts/{errors,path,io}.ts`, shell byte-codec call sites,
   `commands/regex-execution/ere/{matcher,limits}.ts` and its `transport/*`,
   shell/registry entry exports, and shared-FS consumer imports. Gate: the public
   browser shell runs current parser/runtime semantics with shared memory,
   byte-correct pipes, and bounded regex execution.
7. **Distribution:** package exports/declarations, root `scripts/bundle.mjs`,
   public-consumer smoke/package-lint fixtures, and rename metadata, owned by the
   packaging coordinator. Gate: installed `poe-code` exposes canonical entries and
   one contract identity; browser and Node graphs/types resolve without workspace
   aliases.

Do not broaden a leaf's write scope to all runtime code under these scope labels.
Enumerate direct context/codec consumers before assigning implementation, preserve
unrelated changes, and add behaviorally failing tests before each code change.

## Browser validation scenarios

Run these as agent-led browser QA from the packaged public entries, with captured
browser versions, console output, network failures, and screenshots. No permanent
QA driver is introduced by this plan. Source-only bundling is a prerequisite, not
a replacement for real Chromium, Firefox, and WebKit execution.

1. **Public import and capability baseline:** install the release candidate in
   an isolated consumer, bundle its portable entries with browser/ESM settings,
   and open the page and a module-worker variant. With no Node globals or shims,
   `return 1 + 2` returns `3`; missing FS/process/agent modules deny access. Inspect
   the emitted graph for Node builtins and unresolved private package imports.
   Typecheck separate DOM and WebWorker consumers without `@types/node` globals.
2. **Same-instance shared state:** create one memory `FileSystem` in the execution
   realm, give it explicitly to both runtimes, and create `/workspace/shared.txt`
   from the host. SafeJS reads it; shell writes `shell` using a registered portable
   command; SafeJS appends `+js`; host and shell both observe exactly `shell+js`.
   Repeat update/delete and verify the same canonical error constructor/metadata
   through public subpaths. No real-directory adapter or implicit HTTP service is
   involved in this case.
3. **Wrappers and confinement:** repeat with readonly, overlay, and mounted memory
   instances. The lower layer remains unchanged after copy-up; readonly writes
   fail. Traversal, absolute paths outside the grant, dangling/escaping symlinks,
   and colliding inode numbers across mounts cannot reach or mutate denied data.
   Unknown comparison authority fails closed; an actual shared-directory alias
   remains usable. Exercise Unicode, NUL-containing bytes, and byte ownership.
4. **Language and scheduling:** run the same current language-conformance cases,
   including closures, classes/private state, prototypes, generators and async
   generators, promises/thenables, and callback reentry. Run two interleaved
   programs with separate budgets/signals; cancel one and verify the other keeps
   its state, reactions, and output. Remaining language-goal items stay open and
   must become portable as implemented; no browser-specific syntax removals.
5. **Durable execution:** dump a pending read, update the shared file, and restore
   to observe the re-issued read. Dump an effect whose write completed but whose
   reply is pending; restoring without proof requires reconciliation and does not
   repeat the write, while matching proof completes once. Transfer serialized
   compatible snapshots between Node and browser, explicitly rebinding granted
   capabilities; test corrupted markers, forged proofs, proxy/accessor inputs,
   symbols, cycles, and cancellation without weakening current rejection rules.
6. **Browser shell:** exercise pipelines, redirections, byte-exact stdout/stderr,
   asynchronous commands, cancellation/cleanup, and bounded regex failures through
   the public shell entry. Register capabilities explicitly; a passing `echo`
   fixture is not evidence that the current shell engine or full command inventory
   is portable. Node-only command providers must not load implicitly.
7. **Persistence/network extensions, only if shipped:** OPFS stays origin-scoped
   across reloads; a directory-handle adapter starts from an explicit granted
   handle and reports revoked/denied access. Record unsupported browser capability
   outcomes, quota/cancellation, and CORS failures. Never pass a host pathname to
   the Node real adapter and label that a browser test.
8. **Installed artifact and regression gate:** repeat the real page/worker cases
   against the packed and then published poe-code version, record constructor
   identity across canonical entry combinations, and inspect stale output after
   cache-hit and forced builds. Re-run Node filesystem and interpreter regressions
   before claiming the corresponding browser slice ready for release.

## Browser release slice order

Each item is an atomic, green, conventional commit on main with its relevant plan
updates, followed by the existing poe-code GitHub release and published-consumer
verification. Do not queue the next release before monitoring the current one to
success. Partial slices may ship, but must state that browser execution remains
incomplete until its real-browser gates pass.

1. **A/B complete:** shared-FS signal/error fixes, canonical Node packaging and
   explicit Node SDK/CLI configuration/integration are released. Keep Node
   behavior stable; those releases do not establish browser readiness.
2. **C candidate/public gates pending:** ship the frozen portable contracts,
   memory, wrappers, WebDAV and byte bridge with the exact routes and denials
   above. Preserve class/registry identity and prove actual packed declarations.
   This FS-only milestone is a prerequisite, not both browser runtimes.
3. Isolate interpreter file/crypto/validation services, then land owned execution
   context in coherent tested changes. Context and validation cannot be stubbed
   out to publish a browser label. These two tracks may be authored separately
   but must converge before the interpreter browser acceptance gate.
4. Ship the adapter-only portable guest FS facade and portable SafeJS public entry
   after steps 2 and 3. Complete the real-browser language, ownership, and replay
   checks; retain Node facade and existing CLI host-path behavior.
5. Migrate safe-bash to canonical shared FS and its portable shell/worker transport,
   then prove both engines share one adapter in a real browser. Consumer migration
   and deletion of sibling implementations are gated by actual installed imports,
   not by the existence of extraction files. Do not assume virtual-bash publishes
   through the poe-code release workflow.
6. B's Node CLI/SDK adapter configuration is complete. Deliver any further
   browser configuration and the safe-js rename in separate tested slices,
   updating affected skills/templates and screenshots.
   Browser and Node public-entry gates apply to the renamed artifacts too.
   Persistent browser backends remain extensions unless separately selected for
   implementation; their absence must not erase the original browser requirement.

## Browser platform references

Primary documentation consulted for the boundary decisions:

- Esbuild API, platform and export conditions:
  `https://esbuild.github.io/api/#platform` and
  `https://esbuild.github.io/api/#conditions`. Browser selection and Node builtin
  externalization are different build modes; ESM alone does not choose portability.
- Node async context and native type checks:
  `https://nodejs.org/api/async_context.html` and
  `https://nodejs.org/api/util.html#utiltypes`. AsyncLocalStorage propagates context
  through asynchronous work; native type checks do not inspect JavaScript-visible
  properties. Replacements need behavioral/security proofs, not name substitutions.
- Web Crypto digest:
  `https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest`. Its promise
  return matters to the currently synchronous checkpoint-digest interfaces.
- WHATWG File System and WICG File System Access:
  `https://fs.spec.whatwg.org/` and `https://wicg.github.io/file-system-access/`.
  Origin-private storage and user-granted handles are browser capabilities;
  directory picking requires user activation and is not arbitrary host-path access.

## Phases

1. **Investigate the shared contract.** Read both repositories' applicable guidance
   and inspect adapter operations, configuration, instance/state ownership, errors,
   capability boundaries, wrapper composition, and runtime call sites. Record the
   extraction boundary, plain-directory behavior, and future-backend extension
   contract. Placement/distribution is now fixed at `packages/safe-fs` and
   `poe-code/safe-fs`; audit its portable/Node boundary and consumer migration.
2. **Extract with TDD.** Add failing shared contract tests, then move the existing
   adapter and wrapper implementations into safe-fs rather than copying them.
   Preserve the inspected error identity, registries, storage protocols, and
   existing conformance/integration coverage. Expose the existing real backend as
   the explicit configured plain-directory adapter. Both runtimes accept the same
   instances/configuration and observe shared state. Keep backend logic out of
   the runtimes; future backends implement the shared contract once.
3. **Rename and integrate.** Make safe-js canonical and audit the old package name,
   directory, imports/exports, dependencies, CLI/SDK surfaces, skills/templates,
   documentation, build metadata, and published artifacts. Record migration
   decisions without assuming aliases. Expose matching adapter configuration and
   capability controls in CLI and SDK, with the CLI using the SDK. Shared contract
   and runtime integration tests cover each existing backend and wrapper,
   errors, shared state, readonly enforcement, and confinement within documented
   backend limits. Use memfs for unit-test filesystems and mocks for external
   services; keep tests fast and disk-fixture checks in integration coverage.
4. **Validate and deliver each completed item.** Apply this phase to each item,
   not only at the end: run focused/shared/runtime regression tests, typecheck,
   lint, and the manual QA below. Update README under the user's existing
   authorization as support, configuration, environment variables, limitations,
   and migration behavior are verified. Verify stale-artifact cleanup after all
   builds finish. Follow "push commits as you go": commit only the completed
   item's files and relevant plans in an atomic conventional commit on main,
   push with commit/push hooks enabled, and monitor the GitHub release to success
   before shipping another item. Record commit, workflow conclusion, and published
   version. Use the existing poe-code release path where applicable; do not
   assume standalone safe-fs or virtual-bash publication. Never bypass hooks or
   publish locally.

## Manual QA

Execute these steps as agent-led QA, not a new QA automation script. Record actual
cases, results, and remaining gaps in the goal document; passing filesystem checks
does not establish language completeness.

1. Run safe-js and safe-bash with the same adapter instance, then with the same
   configuration through their supported entry points. Write/read/update/delete
   across both runtimes in both directions; confirm shared state and consistent
   errors. Repeat for memory, plain-directory, S3, and WebDAV using controlled
   fixtures and authorized test services, and exercise the extracted wrappers.
2. Point the plain-directory adapter at a disposable directory on the machine.
   Confirm both runtimes see its contents. Try traversal, absolute-path, symlink,
   and mount-boundary escapes, readonly mutations, and overlay interactions;
   verify denied operations leave data outside the granted scope unchanged.
   Record the backend's concurrent-tree-modification limitation; these checks
   do not establish race-proof OS isolation. Treat disk fixtures as integration QA.
3. Review the extension contract against existing backends and a future-backend
   example: identify the adapter implementation/configuration needed and confirm
   neither runtime needs backend-specific branches or duplicated implementations.
4. Compare CLI and SDK configuration, capabilities, results, and errors. Run
   affected CLI commands with `npm run dev -- <command> <args>` and inspect
   `npm run screenshot-poe-code -- <command>` output when CLI behavior changes.
5. Audit active public paths for the canonical safe-js rename and recorded
   migration decisions; retain historical references where appropriate. After
   forced builds, cache-hit builds, and isolated installs finish, inspect public
   entries and reachable outputs for stale or duplicate artifacts. Archive before
   removing only verified obsolete/generated outputs; preserve unrelated work.
6. For each completed item, check README statements against verified behavior and
   update README and record test/QA evidence. For each completed-item push, verify
   the item-specific commit, successful GitHub release, published version, and
   installed public paths before
   marking acceptance complete or shipping the next item.
