# Shared safe-fs adapters and safe-js rename

Status: Node extraction and SafeJS adapter integration exist in the working tree.
Cross-repository migration, the safe-js rename, browser support, and their release
gates remain incomplete. No release is claimed by this plan update.

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

- `packages/safejs/src/modules/fs.ts` now exposes
  `makeFsModule({root?, fs?, adapter?})`; simultaneous `fs` and `adapter` reject.
  Node-backed defaults and host-relative roots remain unchanged. Adapter paths and
  relative roots start at virtual `/`; adapter aliases require authoritative
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

## Browser boundary: observed state

The browser requirement is not implemented. A lightweight export is not yet a
portable export, and the existence of a memory backend is not browser evidence.

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

1. Finish the current shared-FS signal/error fixes and canonical
   `poe-code/safe-fs` runtime/declaration packaging gate. Keep Node integration
   behavior stable; do not claim browser readiness from this release.
2. Make shared contracts, memory, and wrappers portable and ship separate portable
   and Node entries, preserving public class/registry identity. This is the first
   prerequisite for both browser filesystem consumers.
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
6. Deliver remaining CLI/SDK adapter configuration and the safe-js rename in
   separate tested slices, updating affected skills/templates and screenshots.
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
