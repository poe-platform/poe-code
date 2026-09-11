# Issue 699: public optional node composition in workerd

The optional node command needs a published runtime that can execute in actual
workerd. The Poe integration no longer needs node, but the public API gap remains
in scope. Neither the safejs command nor op integration is added.

## Public implementation

- Publish `@poe-platform/safe-js/workerd`, using existing run, Budget,
  declareHostOperation, and makeFsModule exports.
- Build its workerd platform context separately from the normal Node graph in
  both the maintained root bundle and scoped package creation.
- Retain Node context behavior and generic browser refusal. A source-local map
  selects source modules; the outer package map resolves compiled modules for
  unbundled native postbuild imports. Do not emit a nested dist/package.json,
  because canonical filesystem bundle outputs must retain their package scope.
- Move the Node worker provider to the explicit host-only commands/node/host
  export. Keep the injected node command independent of worker_threads.
- Select the existing portable SafeBash root and declarations under the workerd
  condition. The public root supplies Shell and agentCommands; there is no
  separate browser subpath.
- Preserve the native DOMException getter's branding contract; do not replace it
  with shape-based admission on getterless platforms.

## Validation procedure

Run the maintained normal `npm run build` after source changes. Build selected
workspaces before that final build, because workspace emit can overwrite the
root's final bundled artifacts. Run focused regression tests and package gates;
root coordinates the full unit, type, lint, commit, and release steps.

Create a unique temporary directory outside the repository, and stage scoped
packages with an explicit candidate version:

```sh
node scripts/package-safe.mjs --out-dir "$STAGE/packages" --version "$VERSION"
npm pack "$STAGE/packages/safe-fs" --pack-destination "$STAGE"
npm pack "$STAGE/packages/safe-js" --pack-destination "$STAGE"
npm pack "$STAGE/packages/safe-bash" --pack-destination "$STAGE"
```

Install all three tarballs together into a new consumer directory. Copy the
owned optional-node-workerd worker/config fixture into that consumer. Bundle the
worker with esbuild using `platform: node`, `conditions: [workerd]`, ESM output,
and a metafile. Require public installed package inputs, no repository source
paths, no worker-provider/worker_threads in the graph, and the workerd context
rather than the Node context. Do not use a runtime shim or native Node execution
as Worker acceptance.

Run the exact native workerd executable against `config.capnp` with an external
bounded timeout. Require zero exit and `OPTIONAL_NODE_WORKERD_PASS`, with every
assertion in the fixture executed. Retain the package versions, bundle/metafile
hashes, exact workerd version, compatibility date, and raw output in the unique
temporary directory. The fixture requires successful VFS I/O; source/output,
steps, call depth, string/array/data bounds; overlapping executions; exact object
and false cancellation identities despite late successful VFS completion; no
later write attempts/output; healthy subsequent invocations; and absent optional
commands in the default preset.

Typecheck an installed public composition consumer under workerd conditions.
Check host-only imports are refused by Worker/browser conditions and still work
on Node. Repeat the workerd acceptance against exact registry versions after
publication. A green bundle or local candidate is not a verified public release.

## Initial evidence

The current injected-node entry eagerly exported the worker-thread provider.
Actual workerd 2026-09-04 could load Node compatibility imports but failed to
initialize the runtime because DOMException.prototype has no code getter.
Actual AsyncLocalStorage works across await, but native disable is unavailable.
The new profile retires its per-run context without pretending native disable
exists. Proxy detection was verified against plain objects and object/function
proxies in workerd; no security check is replaced by a stub.

Build and packaging regression tests failed before the standalone workerd route
was implemented and then passed. Native SafeJS postbuild checks include the new
entry. The first normal build rejected an emitted dist/package.json through the
unchanged canonical filesystem publication guard. The corrected outer compiled
map keeps native imports working without that nested scope. A second build caught
separate publication pruning the shared output directory's canonical chunks.
The separately built runtime graphs now publish in one transaction; a memfs
regression verifies live canonical chunks survive while stale chunks are removed.
The canonical policy still inspects the original filesystem build metadata.

The first installed candidate exposed two more concrete gaps: the SafeJS fs module eagerly
called workerd's unsupported getSystemErrorMap, and conditional null host types
allowed TypeScript to fall back to the Node declarations. The installed public
composition itself typechecked, while the browser runtime import was refused.
The errno lookup now uses the existing runtime platform seam, retaining native
Node lookup and supported workerd constants. Both packages own empty unavailable
declarations for excluded type conditions; maintained private/root controls
reproduced TypeScript's null fallback before that correction.
The public graph contained all three installed libraries and no worker-thread
provider, worker_threads import, or unresolved private platform specifier.
Further candidate and publication evidence is recorded by the delivery owner.

## Installed candidate result

After the corrections, the maintained normal build passed. Fresh tarballs of all
three packages at candidate version `0.0.0-issue699` were installed together in an
isolated consumer. Native workerd `2026-09-04`, compatibility date `2026-09-04`,
passed the owned fixture's 11 cases with exit zero. The bundle contained 112
installed-package/application inputs and no worker-thread provider,
worker_threads import, source-workspace input, or unresolved private platform
import. The candidate artifact hashes, pack metadata, graph, raw runtime output,
and type controls are retained in `/tmp/poe-699-final-acceptance`.

Installed workerd composition and native host imports passed TypeScript checks.
Named host-provider imports failed under each workerd, worker, and browser
condition; the workerd runtime import failed under browser conditions. Runtime
resolution independently rejected the same excluded exports. Native host import
remained available. Two failure-snapshot warnings were emitted during
intentional cancellation; the fixture still verified exact cancellation reasons,
no later guest output or attempted write, and healthy overlapping/subsequent runs.
The same installed fixture using the native SafeJS root also passed all 11 cases
with the same two MissingReplayCapabilityError warnings
(`/tmp/poe-699-final-acceptance/native-fixture.log`). Replacing guest require calls
with `import * as fs from 'fs'` passed all 11 cases without warnings
(`native-import-fixture.log`). The callable-containing require result lacks resume
IDs for failure-snapshot serialization. This diagnostic does not replace the
original cancellation: the reason is rethrown, retirement runs in finally, and
the fixture's effect fences hold on both runtimes.
These candidate results do not establish registry publication or release success.

## Full-gate corrections

The shared unit suite initially exposed an exact export inventory missing the
three new public paths and a bundle failure mock that assumed the Node graph
always compiled first. The updated tests declare the three paths explicitly and
check both graph failures preserve previously published entry and chunk bytes.
All 46 focused checks passed; the next full run passed 20,345 shared tests.

The SafeBash run passed 22,634 tests with 86 skips and two failures. One
pipeline-close probe exhausted its unchanged three-second child deadline during
TSX/source initialization. The unchanged source fixture passed in about 325 ms
when compiled beforehand. The harness now compiles both probe graphs once in
memory and sends JavaScript through supervised child stdin. The three-second
deadline still includes child launch, input transfer, execution, and retirement;
the output cap, process-group controls, and fixture bytes remain unchanged.
All 33 scenarios and supervisor controls passed, including new stdin delivery
and early-exit controls, with independent review.

The other failure was the committed-export gate correctly rejecting current
package metadata against the older HEAD. Its authenticated committed-source
requirement remains unchanged. A local candidate commit is required before
rerunning that gate; it is not a completed push or release. Full tests, the final
normal build, and maintained lint remain required before delivery.
