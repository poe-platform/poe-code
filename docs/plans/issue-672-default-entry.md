# Issues 669 and 672: default portable entry integration

## Validated failures

The installed public candidate's complete portable preset failed an unshimmed
browser/workerd-conditions bundle on emitted crypto, stream, zlib and timer
imports. The existing published browser subset did not have the leak alleged in
issue 671; that issue was closed without a speculative fix.

The default-entry regression test first failed because the manifest still
required separate browser and portable aliases. Its RED output is retained in
`/tmp/kamilio-672-default-entry-red.log`. Component owners separately reproduced
their actual Node import failures before changing code.

## Integration

- The normal package specifier selects the full default command inventory under
  browser conditions, with a matching `core.d.ts` type surface. Browser and
  portable public subpath aliases and their command factories are removed as
  explicitly requested in issue 669's revised scope.
- An internal core barrel excludes host-only filesystem, HTTP and Node adapters.
  The existing Node root surface remains available, with native path semantics
  and the existing host exports. The explicit `/node` entry exposes the Node
  regex provider; `regexExecutor` injection is shared by default command factories.
- The maintained browser bundle has one canonical filesystem external and no
  external Node builtins. Existing bounded browser shell adaptation is retained;
  this does not turn unsupported regex modes into native fallbacks.
- Browser `posixPath` is the canonical filesystem's limited portable path helper;
  its declaration exposes only those supported methods. The Node root still
  exposes the complete native POSIX path API. No new compatibility shim pretends
  that the browser helper has the native process-dependent path API.
- Incremental hashes and bounded low-level compression use exact pinned portable
  dependencies. Private committed archive verification must authenticate their
  lock entries and actual offline package artifacts rather than silently using
  the checkout's installed dependency trees.
- Both runtime dependencies are also declared on the root package because its
  public `poe-code/safe-bash` Node entry includes the same unbundled modules.
  Relying on dev-only workspace dependencies would break an installed consumer.

## Guarded declaration admission

The real isolated private archive build reproduced TS2307 for both new libraries.
Six in-memory compiler controls reproduced missing declaration admission and
specified rejection of unapproved dependency names, changed pinned identities,
symlinked declarations and unrelated package imports. Before the change five
controls failed and the unrelated-import negative control passed. The complete
guarded-builder suite passes 130/130 after admitting only the two exact pinned
package roots, with existing declaration-only reads and physical identity guards
unchanged. Package metadata is bounded to 64 KiB. No broad node_modules admission
or compiler timeout increase is introduced.

The conditional export also reproduced a TypeError in the maintained typecheck
prerequisite checker, which assumed every target was a string. Its in-memory
regression verifies all nested browser/Node runtime and declaration targets,
preserves explicit null denials and wildcard routes, and fails if any concrete
target is missing. The focused regression passes after recursively collecting
the declared targets. This does not waive the later declaration-origin checks.

## Validation before delivery

### Migration from the retired entry aliases

The revised issue request removes `/browser` and `/portable`, rather than
retaining aliases. Import `Shell`, the filesystem and `agentCommands` from the
ordinary package entry; replace `browserCommands` and `portableAgentCommands`
with `agentCommands`. This is an explicit API and default-regex policy change,
not a claim that older import specifiers continue working.

```ts
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const result = await shell.exec("printf 'hello\\n'");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Browser/Worker bundlers select `browser` alongside their usual `workerd`,
`worker` and ESM conditions. No Node compatibility flag is needed for the
default preset. This does not add the optional host `node` command or enable
network access. The bounded regex dialect retains explicit unsupported-mode
errors; it never falls back to synchronous native RegExp. Node callers needing
the native implementation import `createNodeRegexProvider` from
`@poe-platform/safe-bash/node` and pass it as `regexExecutor` to `agentCommands`.
Default executors are owned and retired by the command set; injected providers
remain caller-owned. Existing cancellation and command-budget rules still apply.

The README's obsolete `/browser` subset section is removed without adding
README content. The remaining Node quickstart already uses the ordinary entry.

### Integrated gate toolchain

The v4 full run used Node 22.23.2 with an older npm 10.9.4/tar 6.2.1 and failed
43 archive/fixture cases because that tar exposes `Parse`, not `Parser`.
The same controls with CI's actual Node 22.23.2/npm 10.9.8/tar 7.5.11 pass:
187 archive controls, one actual committed export acceptance and 20 native
cleanup cases. This is a toolchain correction, not a parser-guard relaxation.
The full maintained route must still be rerun with the matching complete tools;
those 208 focused passes are not a full-suite pass.

Retain independent full command inventory, argument and filesystem identity,
pipeline, byte, cancellation and budget checks while migrating consumers to the
default entry. Run maintained build, lint and full unit routes for the integrated
cross-workspace change. Verify installed public packages under Node and Bun,
browser type conditions, and real workerd with no compatibility flags. Capture
and inspect a visual smoke result. Keep local commit, verified remote-main push
and successful release evidence separate.

## Integration findings on September 8

The complete maintained unit run exposed native-regex fixture helpers outside
the earlier test-file migration. The search stress workers, continuation child,
stdin/streaming/safety cases and adapter-tool fixtures now explicitly inject the
public Node provider. Native execution, cancellation and retirement assertions
remain unchanged; no native fallback is added to the portable default. These
helpers and the exact pinned dependency metadata assertion pass 214 focused
tests. The mktemp provenance control now checks the actual Web Crypto source
and exercises rejection sampling through mktemp itself; its seven controls and
four portable-random tests pass without weakening the host-I/O exclusions.

The same complete run found an original undefined source error being replaced
by AbortError inside archive compression. The unchanged error-identity test
reproduced it before repair; all 360 codec/archive/opaque-error cases now pass.
This runtime correction requires rebuilding and revalidating installed artifacts;
the earlier installed/workerd results do not qualify the changed codec. The full
run remains failed until all remaining isolated archive fixtures are repaired and
the complete maintained route passes again.

The remaining isolated-fixture failures were reproduced individually: recursive
export mirroring rejected the existing filename wildcard, and copied native
cleanup/writer fixtures omitted the two newly declared runtime dependencies.
Mirroring now permits only the declared single `*.js`/`*.d.ts` filename forms;
path globs, traversal and other metacharacters remain rejected. Copied fixtures
stage exact lock/SRI-authenticated artifacts, check their bytes and routes, and
continue refusing missing dependencies instead of falling back to the checkout.
Native cleanup explicitly selects the public Node provider. Focused results:
20 cleanup cases, six writer cases, two export controls and one actual committed
export acceptance pass, with zero scoped TypeScript diagnostics. These results
do not substitute for the subsequent full maintained unit run.

The first installed candidate passed the Node and Bun public smoke suites and
29 actual workerd cases with compatibility flags empty. Its graph contains 34
installed inputs, no external or Node edges, and no emitted imports. This is
intermediate evidence, not acceptance of a later rebuilt artifact.

Installed browser declaration checking found a Node-only filesystem option type
in the SafeJS runtime contract. Its required shape is just optional `cwd` and
`signal`; derive those fields from the portable filesystem bridge options rather
than exposing the Node bridge in the browser. Also check declarations with no
ambient Node types, preserving the complete Node path API through explicit Node
facades instead of silently narrowing existing Node consumers.

The maintained full test route found three root bundle assertions still naming
the removed entry files and one playground regex regression. Update the former
to the new internal entry. The playground already owns browser Worker adapters
and supports native regex modes; explicitly inject its existing adapted worker
provider rather than reducing its regex functionality to the new bounded default.
The root packaging checks then pass 39 tests and the full playground suite passes
166 tests, including worker cleanup and the original regex workflow. No native
fallback is added to the default public preset.

The visual smoke also reproduced a disabled playground terminal: Vite tried to
resolve a synthetic esbuild namespace as a watched physical file. A new focused
regression fails when the watch list includes that nonexistent path. Register
only physical graph inputs for file watching while retaining the full graph in
build evidence; keep explicit adapter watches. Repeat the real browser smoke
after the correction rather than treating the successful bundled kernel test as
proof that the interactive development server loads.

The initial full test route remains a recorded failure (20,240 passes, four
failures, one skip in the shared task); it is not a completed full-repository
pass. Repeat the maintained full route after integration is frozen, then rebuild,
pack, and re-admit the final installed artifact for browser and workerd checks.

The final installed browser smoke exposed one additional stale subset assertion:
it required all 79 commands to declare filesystem modes. The previous installed
full preset independently has exactly 31 declarations and 48 undeclared commands.
Preserve that exact declaration inventory and require undeclared support to stay
partial rather than inventing optimistic capabilities. The corrected browser
fixture passes against the unchanged final package tarballs. Installed Node and
Bun smoke and strict browser declarations without ambient Node types also pass.
Actual workerd acceptance for the final artifact passes all 29 cases; see the
separate installed-artifact validation document for hashes and cleanup evidence.

## September 8 delivery gate update

The maintained `npm test` route completed with exit zero using CI's exact
Node 22.23.2/npm 10.9.8 toolchain. Evidence is
`/tmp/kamilio-delivery-v6.K4UWR1/unit.log` and `unit.exit`, with its starting
revision recorded in `head`. This includes the normal pre/event/post scripts:
20,245 shared tests; 291 SafeBash runner controls; 22,385 SafeBash cases;
21,631 SafeJS cases; 288 terminal-pilot cases; 29 Python cases; and two root
lint stress cases passed. Explicit skips remain skips, not passes. Focused
upstream Unicode-whitespace and snapshot regressions also pass after rebasing.

The v5 public artifact is rejected, not accepted: packaging after the unit
route's workspace build captured an unbundled 67-byte browser entry. Changing
resolver conditions cannot fix that artifact. The normal `npm run build`
subsequently completed with exit zero, including its maintained browser
bundling suffix (`/tmp/kamilio-672-delivery-v7-build.log`). No later workspace
build runs before packaging the v7 candidate.

The freshly packed and offline-installed v7 candidate is
`/tmp/kamilio-672-delivery-v7-public.8OvgFK`, source
`6355de7e74737f4c382e891140a936bc847240f1`, version
`0.0.0-issue672-delivery3`. Node and Bun public smoke, Node declarations,
strict browser declarations with no ambient Node types, browser bundling and
browser execution pass; `public-smoke.exit` is zero. This does not reuse the
v3/v5 tarballs. Fresh actual-workerd admission and execution are recorded
separately in the workerd validation document before final push.

Maintained repository lint is also clean:
`/tmp/kamilio-snapshot-repair-lint.exit` is zero. The intervening release-only
repairs alter tests, documentation and queue policy, not the portable product
runtime. Preserve separate local, remote-main and published-release statuses.
