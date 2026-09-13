# Final Promise admission artifact qualification

The final narrow public filesystem export is `@poe-platform/safe-fs/node/filesystem` (root compatibility route `poe-code/safe-fs/node/filesystem`). It exports the existing adapter module. Earlier local preparation logs used a provisional `/node/bridge` name; that name was never published. The legacy `/node` export is unchanged. Source base and exact candidate file hashes are in `candidate-source-hashes.json`.

## Prepare and install

Run the maintained `npm run build`, then `node scripts/package-safe.mjs --out-dir <fresh-physical-directory> --version 0.0.0-promise-filesystem`. On macOS use a physical path under `/private/tmp`, not symlinked `/tmp`; native asset validation correctly rejects the latter. Pack SafeFS and SafeJS with `npm pack <directory> --ignore-scripts --pack-destination <consumer>`, then install both tarballs in the fresh consumer with `npm install --ignore-scripts --no-audit --no-fund <tarballs>`. No workspace symlink or source alias may substitute for installed package resolution.

The recorded final preparation and installation passed. An earlier `/tmp` preparation failed before packing because of the native-asset symlink check; it was retried using a new physical directory without changing that check. The source workspace had preserved unrelated Safe Bash/README changes; these local artifact checks qualify SafeFS and SafeJS behavior, not a claim that an uncommitted Safe Bash candidate was published.

## Actual Workerd

Write this source beside the installed consumer's package.json:

```js
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { run, admitNativePromiseProperties } from '@poe-platform/safe-js/workerd';
export default { async fetch() {
  const checks = [];
  for (const surface of ['binding', 'host']) {
    const storage = new AsyncLocalStorage();
    const unique = Symbol('kResourceStore'), global = Symbol.for('async_id_symbol');
    const input = storage.run({ secret: 'host-context-secret' }, () => Promise.resolve(unique));
    const shared = { input };
    for (const [key, value] of [[unique, shared], [global, shared], [Symbol.toStringTag, 'CallerPromise']]) Object.defineProperty(input, key, { value });
    let calls = 0;
    const accessor = Symbol('accessor');
    Object.defineProperty(input, accessor, { get() { calls++; return 100; } });
    assert.throws(() => admitNativePromiseProperties(input, [accessor]), TypeError);
    const prefix = surface === 'host' ? 'const input = (await load()).input; ' : '';
    const bindings = surface === 'host' ? { load: () => ({ input }) } : { input };
    assert.deepEqual((await run(prefix + 'return Object.getOwnPropertySymbols(input).length', { bindings })).returnValue, 0);
    admitNativePromiseProperties(input, [unique, global, Symbol.toStringTag]);
    Object.preventExtensions(input);
    const result = await run(prefix + `const keys = Object.getOwnPropertySymbols(input); return [keys.length, input[keys[0]] === input[keys[1]], input[keys[0]].input === input, keys[2] === Symbol.toStringTag, input[keys[2]], Object.isExtensible(input), Object.getOwnPropertyDescriptor(input, keys[0]).writable, await input === keys[0]];`, { bindings });
    assert.equal(result.ok, true);
    assert.deepEqual(result.returnValue, [3,true,true,true,'CallerPromise',false,false,true]);
    assert.equal(calls,0);
    checks.push({surface, passed:true, accessorCalls:calls});
  }
  return Response.json({runtime:'workerd',icu:'not exposed',checks});
}};
```

Bundle it using esbuild with `bundle: true`, `platform: "neutral"`, `format: "esm"`, `conditions: ["workerd"]`, `external: ["node:*"]`, `metafile: true`, and `outfile: <consumer>/worker.mjs`. Require no `native-seek` input and no unresolved import. Do not externalize or replace `#safe-fs-native-seek`.

```capnp
using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
 services = [(name = "main", worker = (modules = [(name = "worker.mjs", esModule = embed "worker.mjs")], compatibilityDate = "2026-09-01", compatibilityFlags = ["nodejs_compat"]))],
 sockets = [(name = "http", address = "127.0.0.1:37652", http = (), service = "main")]
);
```

Run `npm exec --yes --package=workerd@1.20260901.1 -- workerd serve <consumer>/config.capnp`, then `curl --fail --silent --show-error http://127.0.0.1:37652/`. Stop that server after checking the response.

Final installed scoped artifact result: both binding and nested host-result controls passed, with zero accessor calls. The restored root bundle was separately compiled from `packages/safe-js/dist/workerd.js` with these same conditions and passed the same actual Workerd response. Runtime reports `workerd 2026-09-01`; ICU is not exposed. The compatibility date is 2026-09-01. `nodejs_compat` is host harness authority; Workerd reports it is already the default at this date. Node's separate active/retired AsyncLocalStorage controls remain the nonvacuous own-symbol isolation checks. Workerd has no native `disable()` method; no retired-store result or unavailable public realm/dump API is invented for it.

## Minimum Node and runtime registry scope

The installed final scoped candidate passed on Node **18.18.2 / ICU 73.2**: import the new bridge and legacy bridge and assert identical functions; admit a unique symbol whose Promise property and settlement both equal that key; require `[true, true]` for original execution and completed dump/restore replay. Normal preparation uses Node **22.23.2 / ICU 78.2**. The prior seven-runtime admission matrix is historical evidence for the unchanged admission implementation, not a newly rerun matrix for this import repair.

Installed Node index/core exports share the same admission function. The independently bundled Workerd entry has a separate registry: register using the entrypoint whose `run` imports the Promise. Original and completed replay pass through each entrypoint with binding and host-result inputs. This corrects the earlier inference from source-module identity to cross-bundle identity, without relaxing the source export assertions.

## First publication and recovery

Commit `11a7a80571a633cd452fde83a3fd57290fc019a4` is verified on remote main. Scoped workflow `34728928966` succeeded and published all three safe packages as **0.1.564**. `first-registry-receipt.json` binds all downloaded tarballs to their registry SHA-512 values and matching SLSA subjects/source commit/workflow. npm verified **16 registry signatures and 10 attestations** in the installed complete consumer. Packages do not ship an embedded PROVENANCE.json; registry provenance is used.

SafeFS and Safe Bash became downloadable before SafeJS and were independently smoke-tested (memory filesystem write/read plus shell `cat`). SafeJS metadata, attestation and tarball propagated separately: explicit version and alternate read-only URL attempts returned 404 before eventual success. SafeJS's installed index/core/Workerd-entry controls then passed binding and host-result symbol identity, settlement, completed replay and retained-context exclusion under Node. This does not make the published 0.1.564 Workerd filesystem barrel safe: the final narrow export requires the follow-up release. All final publication versions and required root workflow conclusions remain separate terminal receipts.

## Interrupted checks and visual inspection

The first full lint run reported 58 errors in archived Test262 reference JavaScript. Those byte-identical references are now `.js.txt` evidence, with hashes and restoration instructions in `../reference-fixtures.md`. No lint configuration, upstream assertion, corpus selection or runtime budget was disabled. Full lint subsequently passed 11,493 configured files, zero errors/warnings, plus type contracts and workflow lint.

Early full test attempts were stopped after concrete failures: the exact root export inventory lacked the new route; the CLI startup scan tried to read `packages/.DS_Store/package.json`; nested test aliases selected `/node` before the longer export. Exact export inventory, directory-only enumeration and longest-first aliases repair these without dropping assertions or declared tasks. Focused resolution controls passed 38 tests, and admission/package-policy controls passed 584 tests.

`npm run screenshot-poe-code -- --help` unexpectedly launched its legacy cached predev build while tests ran. It was stopped; its prerequisite build is not counted as the maintained build. The deletion of `safe-fs-core.js` caused a concrete module-resolution failure in the concurrent filesystem control. After an uncached maintained rebuild the same control passed all 14 tests, and the full test command restarted. The completed screenshot used `npm run screenshot -- node dist/bin.cjs --help`; `screenshots/node-dist-bin.cjs-help.png` was visually inspected and its CLI help layout is complete and readable. No screenshot test or visual design change was added.

The first full shared unit group of the restored run passed 917 files / 22,603 tests with two skips. This is an intermediate group, not a terminal `npm test` claim. Terminal counts, unavailable/optional cases and final releases must be recorded when the complete maintained command finishes. The ECMAScript edition target and separately tracked newer APIs remain unchanged.

## Committed metadata admission

The restored broad attempt subsequently failed the strict S3 archived-revision check before any build step: `Peer binding requires the selected committed root metadata`. `node packages/safe-bash/tests/integration/s3-http-exports/verify.mjs HEAD <report>` reproduced it independently. The only root metadata difference was this task's uncommitted filesystem export. No `S3_HTTP_EXPORTS_REVISION` or peer-artifact override was supplied. The assertion remains unchanged: local atomic commits are required before rerunning the maintained gate against the actual candidate HEAD. `committed-metadata-red.json` retains the failure and `root-test-uncommitted-metadata-interrupted.log` retains the interrupted broad attempt. No product or validation change was made to bypass that requirement.
