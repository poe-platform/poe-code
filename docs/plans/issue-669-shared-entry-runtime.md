# Issue 669: shared browser/portable entry runtime

## Scope

Fix the validated mixed-entry compatibility defect only. This does not complete
the portable-default request and is not grounds to close issue 669. Changes are
limited to the safe-bash bundler, its maintained tests, a public-consumer fixture,
and this document. Root owns build/package integration; another worker owns the
portable regex backend. No ambient registry or relaxed ownership validation.

## RED evidence (2026-09-08)

Using Node v22.22.0 from `/tmp/kamilio-toolchain.path`:

```sh
export PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH"
npm run test:unit -- scripts/bundle-safe-bash.test.ts -t 'runs nested env/xargs across public built'
```

Result: one failed test, seven skipped. The fixture imports public
`@poe-platform/safe-bash/browser` and `/portable` names resolved using the current
package export manifest to real esbuild output files held in memfs. This is a
built public-consumer test, not a same-source import test or a claim about a
downloaded 0.1.470 tarball. No test creates files on disk.

Same-entry portable execution passes all four commands. A browser `Shell` using
the portable preset/provider fails each nested dispatch with the internal error
`Expected owned command arguments`. The first assertion reports:

```text
script: env jq -nc '1+1'
expected: exitCode 0, stdout "2\n", stderr ""
received: exitCode 1, stdout "", stderr "env: internal error\n"
```

The remaining cases are `printf '"1+1"' | xargs jq -nc`,
`env env jq -nc '1+1'`, and `printf '"1+1"' | xargs env jq -nc`.

## Root cause and proposed fix

Independent browser and portable esbuild invocations each inline the shell and
contracts. `contracts/command.ts` has a module-local `argumentCarriers` WeakSet;
the browser shell creates a carrier that the portable nested executor correctly
rejects as foreign. Portable-only execution shares one module instance and works.

Produce browser and portable together with ESM splitting and private shared
chunks. Keep both existing public entry filenames and exports. Make the shared
POSIX path implementation browser-safe; retain portable-only Node dependencies
outside the browser reachable output graph. Preserve the full 79-command preset,
canonical filesystem identity, and rejection of forged argument carriers.

The bundler options change from single `outfile` to `outdir` and both entrypoints.
Root must change `scripts/bundle.mjs` to build/publish this graph once, passing
`shellOptions.outdir` instead of `path.dirname(shellOptions.outfile)`. The existing
package copier follows relative imports; verify shared chunks survive packing.
No new public API or export-map entry is required for private chunks.

## Validation

1. Keep same-entry success as the control and mixed-entry execution as regression.
2. Assert shared shell/contract identities and strict forged-carrier rejection.
3. Traverse browser-reachable emitted imports and reject all Node builtins.
4. Preserve portable inventory and existing browser runtime tests.
5. Run the narrow maintained bundler test route and relevant lint checks.
6. Root verifies packaging/integration and the remaining portable-default work.

## GREEN evidence

```sh
npm run test:unit -- scripts/bundle-safe-bash.test.ts scripts/package-safe.test.ts scripts/publish-bundle.test.ts
node node_modules/eslint/bin/eslint.js scripts/bundle-safe-bash.mjs scripts/bundle-safe-bash.test.ts scripts/fixtures/safe-bash-mixed-entry-runtime.mjs
git diff --check
```

On Node v22.22.0: all three files / 22 tests pass (3.14 seconds); scoped ESLint
passes. The eight bundler tests cover the public-built mixed-entry execution,
shared Shell/error/argument identities, foreign-carrier and mismatched-args
rejection, byte-value identity, exact 79-name inventory and actual registration,
browser reachable graph isolation, canonical filesystem identity, filesystem
pipelines, budgets, parse admission, cancellation, and disposal.

No source runtime, plugin, provider, contract, public entry, manifest, packaging
implementation, or README changes are part of this subfix. No global registry is
introduced. Portable-only Node imports are retained; this compatibility fix does
not claim that the complete portable entry is Node-free. Unit consumer outputs
remain in memory, so these results do not claim a native packed-tarball smoke.

Root integration also needs to adjust `scripts/bundle.test.ts` to expect one
split build and the graph assertion in
`packages/safe-bash/tests/plugins/portable-agent.test.ts` to inspect only outputs
reachable from browser.js, not every input of the new joint build. Those files
are outside this worker's ownership; the required changes have been handed off.
The focused packaging/publisher tests are GREEN but do not replace root's real
build/pack acceptance. No staging, commit, push, release, or issue closure was
performed by this worker.

## Packed POSIX regression follow-up (2026-09-08)

Root integrated the joint build in `79db48ff8`, followed by export coverage in
`7322b78b9`. The initial focused tests did not cover the public POSIX path object.
Root's actual packed consumer exposed a regression at
`/tmp/kamilio-669-packed.IMlXxW/consumer/safe-packages-smoke.mjs:27`:
`portablePosixPath.sep` was undefined instead of `/`. The root Node entry passed.
The retained evidence is `/tmp/kamilio-669-packed.IMlXxW/node.log`.

The shared path shim exports safe-fs's five-method subset, whereas the previous
portable bundle exposed the complete native `node:path.posix` object. Constants,
normalize, parse, format, and the remaining native surface cannot be preserved by
silently replacing it with that subset. A partial polyfill would also change
resolve/relative working-directory behavior and the posix/win32 references.

After root explicitly released the edit freeze, the maintained built-public test
was extended with the unchanged packed smoke expectations and native object
identity. Before the fix:

```sh
npm run test:unit -- scripts/bundle-safe-bash.test.ts -t 'bundles the complete portable preset'
```

RED: one failed, seven skipped; `expected undefined to be '/'` at
`scripts/bundle-safe-bash.test.ts:123` on Node v22.22.0.

The minimal fix supplements only the exact `src/portable.ts` build input with an
explicit `export { posix as posixPath } from "node:path"`. It overrides the star
re-export for that one public name. Entry selection uses exact path equality;
there is no regex source rewrite. The esbuild onLoad registration uses its
required catch-all filter. Source entries and declarations stay untouched.

Portable retains the entire native public POSIX object and its existing host
semantics. Browser retains its existing Node-free adapter. Shell, carrier and
other contract identities remain shared, and no Node import becomes reachable
from browser.js. Making the whole portable entry host-free is later work, not a
promise of this additive compatibility fix. No pure-path implementation, README,
manifest, packed smoke assertion, or packaging implementation was changed.

```sh
npm run test:unit -- scripts/bundle-safe-bash.test.ts scripts/bundle.test.ts scripts/package-safe.test.ts scripts/publish-bundle.test.ts
```

GREEN: four files / 30 tests passed. The real public-built API is checked against
native `path.posix` by object identity, not just a short list of method names.
The browser-reachable zero-Node-import assertion remains unchanged and passes.
Root owns the subsequent rebuild, new packed consumer, Git and full gates; the
old packed failure remains intact. Issue 671 installed-output/workerd validation
must use that new candidate rather than infer browser reachability from the
unbundled `dist/contracts/io.js` and `dist/contracts/path.js` files.
