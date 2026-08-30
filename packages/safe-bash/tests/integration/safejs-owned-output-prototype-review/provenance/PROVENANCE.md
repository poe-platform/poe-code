# Owned-output prototype: preparation seal

August 27, 2026. **Authenticated for ROOT to assign separate actual-engine surface
and lifecycle workers. No guest, product-runtime, private-engine, native-oracle,
or network probe ran here. No surface/security/lifecycle verdict is made.**
The production gate identified by ROOT as 8670 is separate. This is not an
owned-output production API, release gate, superiority claim, or completion claim.

## Single authentic candidate

Final independent evidence is `e57b5aa16f749b6fac558877dff0712e64df05a8`.
That commit seals Q1 ordering evidence; it is **not** a production code commit.
Its candidate is exactly the S1 compiled/source payload, also archived by the
qualified author at `b8f5d46acf293138482b522d7b5f7263865b1303`:

- Source: `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
- Tests: `dd1814102e91c030d9cb1723bbaf69c3bf467ecd404e89dcb07cc315e5f5e35c`.
- Compiled: `2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`.
- Qualified candidate archive: `a3b9aa6fcb4596e8281de2c30943b98baa01449941c8368401d1172bce95d420`.

These inventory hashes retain the original compact sorted
`[{path,bytes,sha256},...]` serialization. All 940 archived files were checked,
including all 213 source files, 15 selected historical test/helper files,
708 compiled files, and four package/build inputs. This does not cover the
present repository's entire test inventory.

Fresh frozen task: `/private/tmp/safe-bash-owned-output-prototype-preparation-rE94MK`.
`/tmp` resolves to the host's `/private/tmp`; every entry below this task is a
regular file/directory, not a created symlink. Candidate, baseline, committed-base,
inputs, engine, copied tooling, rebuilt source, and consumer are read-only.
The enclosing task remains writable for separately owned later evidence.

## Exact base and apply sequence

All input bytes come from Git blobs at the evidence commit, never current source
or an old live TMP overlay. Full blob IDs, SHA-256s and absolute task paths are
bound in `assembly.json`. Paths below are relative to
`tests/shell-stress/first-read-contract-review/` inside the frozen `inputs/` tree.

1. Extract `owned-output-prototype/baseline.tar.gz.data`, SHA-256
   `0066bc48069f116b549ea895e4972c02ed6958be641fd23ea3b6db26cc181f05`.
   The recorded Git base is `c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79`,
   **plus three accepted dirty tree-command files**, authenticated independently
   against `3eba797a2f286c80149dff22afbcd177e3ffea08` preserved captures.
   The archived base is not a clean checkout of that commit. Its 227 files contain
   the complete 212-file source inventory, four root build/package inputs and
   11 historical execution inputs. `committed-base/` separately freezes the full
   original committed source plus those four root inputs. No live fallback exists.
2. Apply `owned-output-prototype/source-r1.patch-data`, SHA-256
   `d73bb2637d54b97f62fd6e1baa57100cf0018a763679c31386349e30a19cc4e2`,
   introduced by `1ff82cb748c60145740dba354610ac7ed7a7f15f`.
   Restore the three original captured author/adapted fixtures as named in
   `prepare.mjs`; authenticate the intermediate v1 `handoff.json` inventory.
3. Apply `owned-output-streaming-prototype/baseline-current-retention.patch-data`,
   SHA-256 `063751093b7cf887d35b33498b65e1ef49a2f35f9dfb28e368ab6e409fda05b5`,
   introduced by `ddbb4d1031d5d7a5a73ef8b3d846cac886bcf679`.
   This is the frozen four-file retention delta, not permission to use current files.
4. Apply `owned-output-streaming-prototype/source-S1-r0.patch-data`, SHA-256
   `80c523e21610d90c67c8ab0084532ab465f645a0d57442dcd952795de01f2f3f`,
   introduced by `c5e2d338f2ef03861d0ae3c1d04f69e35dc9a605`.
   Restore `author-r1.test.ts.data` as the separate S1 author fixture. Its hash is
   `46291ac212a145924e477cb1d2767ec776b4ec9b53ae036c184699c7d220e03b`.
5. Check every source/test/root input against the author manifest sealed by
   `c1985fd5ef365312a098148528cee517064cfaa9`. The independent fixture replay
   `669c881b7ae73e7731d721f124f457d10e7d8ec5` is historical evidence, not another
   source overlay. Rebuild only this regular TMP copy with copied existing tsc.
6. Match all 708 newly emitted artifacts byte-for-byte to the qualified candidate.
   **No later qualified source patch is needed.** Q1 S2 equals S1 source.
   `97909bec33c440e9917b13df188af1ad19700e23` corrects three ordering fixture
   bindings; `13536dd8705cdbfc68a19da1549b21b069020f41` adds sealed declaration
   captures. Their `driver.mjs.patch-data` and `lifetime.mjs.patch-data` are
   fixture deltas, not product patches. Do not apply them to the product tree.

The three historical dirty inputs, not substitutes for the base:

| Source | Preserved SHA-256 |
| --- | --- |
| `src/commands/tree/arguments.ts` | `848b3e07aafefc67de77efccaa446904d9a1920cb158e094217c18e24a6a2762` |
| `src/commands/tree/io.ts` | `163f2412e5fcca1dc0cd0ac7264beb29b8180efdd65c34fdff08f84a670471e1` |
| `src/commands/tree/tree.ts` | `2ebcf54d9804e7000bf3de4780d598b8b6bc157ee411c134dea5c62717738ef1` |

Nineteen base source/config files have preserved captures; only these three differ
from committed base bytes. Two preparation assertions initially conflated a clean
commit with the accepted dirty base, then conflated preserved captures with dirty
files. Their exact scripts and failures remain in `prepare-r0.mjs.data`,
`prepare-r1.mjs.data`, `preparation-first-failure.json` and
`preparation-subsequent-failure.json`. Neither attempt reached a build or execution.
The corrected third preparation succeeds. The first and only public build succeeds.
A prior read-only zsh listing used reserved variable `path`, temporarily losing
command lookup in that one shell; rerunning with `item` changed no files or inputs.

## Actual API, not a proposed facade

Inspected source, compiled JS and strict candidate declarations agree:

```ts
interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  readonly ownedOutput?: {
    readonly consumerClosed: AbortSignal;
    write(chunk: Uint8Array): Promise<void>;
  };
}
interface OutputOperation {
  readonly signal: AbortSignal;
  readonly output: ByteSink;
  registerCleanup(cleanup: InvocationCleanup): void;
  acquire<Value>(start: (signal: AbortSignal) => Value | Promise<Value>,
    release: (resource: Value) => void | Promise<void>): Promise<Value>;
  child(destination: ByteSink): OutputOperation;
  close(): Promise<void>;
}
declare function createOutputOperation(
  context: Pick<CommandContext, "signal" | "registerCleanup">,
  destination: ByteSink): OutputOperation;
```

`ownedOutput` is optional; its `consumerClosed` and `write` members are required
when present. The accounted method is actually named `write`, not `accountedWrite`.
There is no named exported `OwnedOutput` type. `InvocationCleanup` and optional
`CommandContext.registerCleanup` already exist. Optional `HttpRequest.registerCleanup`
is a TEMP transport proposal carried by this payload, not a production integration.

The prototype's **actual public root** exports `createOutputOperation`, via unchanged
`src/index.ts` export-star forwarding and the patched `src/contracts/index.ts`.
The original package export map also permits `virtual-bash/contracts` and
`virtual-bash/contracts/output`. Thus the operation is not merely an inaccessible
internal symbol in this TEMP package. `OutputOperation`, `ByteSink` and
`InvocationCleanup` are type-only exports. `build-proof.json` enumerates all 218
root declaration exports and records zero strict declaration diagnostics.
This is static/export and build proof; it is not a runtime import trial.

Public production-facade symbols present in the frozen package include
`safeJsCommands`, `createSafeJsCommands`, `makeSafeJsFsModule`,
`makeSafeJsShellModule`, `createBytePipe`, `Shell`, and `MemoryFileSystem`.
`GuestInput`/`GuestOutput` in `commands/safejs/io`, and `Budget`/`Capture`/`Runtime`
in `shell/runtime`, remain internal compiled modules, not root or package-subpath
exports. The historical Q1 internal compiled facade must not be represented as a
new public API. This preparation introduces no exports or facade.

`operation.output` only implements `write`; it does not forward owned-output
metadata or imply parentage. Explicit `parent.child(destination)` is the real API.
Normal close is not abort; close can replace an earlier exception if used naively
in `finally`. It is not an exception-precedence combinator. Opaque host work,
input handback, rollback, leases, universal cursor conservation, forced host
termination, implicit opt-in, and new global stage cancellation are unsupported.
Retain the current S1 contract and the qualified Q1 contract/profile separately;
the latter clarifies precedence and native profiles without changing source.

## Private engine and existing tooling

Actual private HEAD before and after is
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`. Index SHA-256 is unchanged:
`2dc2ac516c19864f952c493eb39374db1a2946f359d31dfb6fd02a5fccfb6bc2`.
Both snapshots use `GIT_OPTIONAL_LOCKS=0`; HEAD/tree, index content/mode/mtime/ctime,
porcelain status, staged paths, six metadata inputs, and all 264 regular engine
package files match exactly. Atime is intentionally not a write-proof field.
No claim is made about unrelated untracked private file contents or ignored caches.

Preexisting modified `package.json`, `package-lock.json` and
`packages/poe-agent/package.json` remain; the four preexisting untracked status
entries remain. No private source, build, installation, worktree, symlink, config,
cache or upstream patch was written. Only regular unchanged source copies live in
TMP; **no private source bytes are committed**. The full ordered
`[{path,sha256},...]` engine inventory identity is
`a73fd1b639c73f2bf995867b081ef62bd34e303ea4464921c3bd904bccc3ae7b`.

The legitimate source hooks for later injection are:

- `engine/src/run.ts`: `run(source, options)`.
- `engine/src/interp/budget.ts`: `new Budget(options)` for `createBudget`.
- `engine/src/modules/fs.ts`: `makeFsModule`.
- `engine/src/interp/host-bridge.ts`: `declareHostOperation`.

These are actual definition modules and exports of inspected private `src/index.ts`.
The private package's own public barrel also reaches `@poe-code/agent-spawn` and
`@poe-code/frontmatter`; do not import that barrel or claim a private-package install.
The selected static source import graph has 63 files and only `node:async_hooks`,
`node:crypto`, `node:fs`, `node:fs/promises`, `node:path`, `node:util` external imports.
This is not an actual-loaded-module count for this phase: **zero engine modules ran**.
Actual supported injection follows the prior f449/private-bb23 audit, not a fake engine.

The frozen unchanged loader is copied from
`tests/integration/safejs-cleanup-regression/surface/loader.mjs`, SHA-256
`3306a11120061037c285dea765728157afd277b4ce8b566e52cf57073a03335b`.
Later workers can bind `SURFACE_ROOT` to their own regular copied tree and
`SURFACE_IMPORTS` to an owned journal. The loader permits only that tree and Node
builtins, resolves copied engine `.js` specifiers to `.ts`, and transpiles in memory
using copied TypeScript. It is not invoked here. Do not import private live paths.

Existing public development installs were copied regularly and hashed per file:
TypeScript 5.9.3 (132 files), `@types/node` 22.20.1 (74), and `undici-types` 6.21.0
(41). All original 358 compiler-input hashes remain authenticated by the historical
manifest; this phase runs the source build and strict declaration inspection, not
the historical whole input-list typecheck. Node 22.22.2, Darwin arm64; Node binary
SHA-256 `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
No new dependencies or network access. The existing private dist is never loaded.

## Deterministic regular-TMP recipe

The prepared public consumer is `consumer/node_modules/virtual-bash/` beneath the
task, with the original `package.json` and all exact compiled bytes. No npm install,
pack, package-manifest edit or symlink is needed. It is an assembled compiled
consumer, not a claim of newly tested publish/pack behavior.

For a new preparation, materialize byte-identical `snapshot.mjs`, `prepare.mjs`,
`build-proof.mjs`, and `verify.mjs` into a fresh regular `/tmp/<unique-tools>/`
using apply_patch. Never execute an inert historical `.data` file in the repo.
From `/Users/kjopek/Workspace/safe-bash`, run, in order:

1. `node /tmp/<unique-tools>/snapshot.mjs before`.
2. `node /tmp/<unique-tools>/verify.mjs --private-pin`.
3. `node /tmp/<unique-tools>/prepare.mjs`.
4. `node /tmp/<unique-tools>/build-proof.mjs`.
5. `node /tmp/<unique-tools>/snapshot.mjs after`.
6. `node /tmp/<unique-tools>/verify.mjs --inputs-only`.

All newly created data then stays in those regular TMP tool/task directories.
Preparation refuses existing output files, uses fixed evidence Git objects, validates
all patch/source/compiled hashes and never imports product or engine code. The build
command is Node plus copied `typescript/bin/tsc -p tsconfig.build.json` in the fresh
reconstructed copy. First build output is saved before asserting success; do not
replace a failed artifact or silently use live declarations. The strict declaration
inspection uses copied TypeScript, not product execution. Failed namespaces remain
separate; no retry edits any sealed candidate. Final verification must pass before
ROOT authorizes later bounded engine probes. No guest command is part of this recipe.

## Planned targets, not results

Subsequent independent workers should separately cover these bounded, real surfaces:

- Production SafeJS command's `fs`, `stdio`, `command` module construction in
  `src/commands/safejs/index.ts`; its `GuestInput`/`GuestOutput` byte/text/console
  adapters in `io.ts`; explicit FS facade in `src/integrations/safejs/filesystem.ts`.
- Public `makeSafeJsShellModule` guest `exec` options/results, and supported static
  named/namespace imports, aliases and nested plain records of those same legitimate
  facades through the engine's `modules/registry`, `host-bridge`, and cancellation
  wrappers. Do not grant a raw context/sink/signal/operation merely to make a test leak.
- Existing host-only `CommandContext.registerCleanup`; the actual new sink metadata
  `ownedOutput.consumerClosed` and capability `write`; operation callbacks
  `registerCleanup`, `acquire(start, release)`, `child`, and `close`. Arrange real
  Shell/command-owned host fixtures and observe whether any guest-reachable value
  exposes them; distinguish reachability from host-side lifecycle behavior.
- Positive controls must demonstrate supported calls on the same legitimate
  bridges, such as exact `stdio.write`/byte output, a bounded VFS operation,
  `command.setExitCode`, or public shell `exec` result. Negative member/own-key/
  callable-alias probes inspect those same facades, not contrived raw host grants.
  Any cleanup registration marker is conditional on discovering a real reachable
  callable, not a pre-granted guest capability. No such marker is invoked here.
- Lifecycle workers own a separately frozen finite cohort with synchronous cleanup
  enrollment, bounded sink closure, caller abort, parent/child admission and explicit
  release of controlled late resources. Record whether cancellation is cooperative,
  cleanup settlement, errors and process exit separately. No runaway/raw-engine
  execution is authorized by this preparation.

The prior cleanup surface audit's first 0/13 harness attempt and corrected 13/13
bounded attempt remain historical; its unsupported `Reflect`/function-spread
assumptions, supported closure call/apply, directory-entry shape and exact thrown
errors are not newly demonstrated leak guards. The old integration 18/19 and
external-only raw-host cancellation/replay limitations remain as recorded.

## Evidence limits and before/after interval

The independent Q1 record is 32/32 parameters across 12 logical cases; it preserves
original raw 31 pass/1 blocked and conservative 29 pass/3 blocked qualifications.
The unchanged five old first-read probes remain prototype 1/5 versus baseline 0/5;
the separately opted-in five are 5/5, not a replacement cohort. None was rerun here.

Native `AbortController.abort(undefined)` produces the native default AbortError.
The Q1 explicit-undefined case uses a native-branded signal with per-instance public
`reason`/`throwIfAborted` overrides; `AbortSignal.any` still sees the backing default
reason. Retain that synthetic/native distinction. Native curl 8.7.1/Bash 3.2 on
Darwin and build/dyld limitations are historical host profiles, not Linux parity.
Product default 0/pipefail 141/genuine write 23 versus native writeout 0/bodypipe 23,
missing baseline nested returns and unavailable product PIPESTATUS remain distinct.

Private read-only evidence interval is 2026-08-27T14:08:27.096Z through
2026-08-27T14:16:50.015Z; this is an observed interval, not full work duration.
Public HEAD concurrently advanced from `4d524fd8d8c7f0bfbafba625778e8fa4550acf5f`
to `b871222100d0453a570b80fa7b41b1181be8eb67`. Six foreign new source paths under
`src/commands/column/` and `src/commands/grep-aliases/` appeared. Their hashes are
recorded, not reverted, imported or included in this frozen overlay. Existing
public source entries and all root inputs remain unchanged; foreign staging is
unchanged. Do not label the entire live checkout unchanged. Only new provenance
paths in this owned directory are included in this worker's atomic commit.
