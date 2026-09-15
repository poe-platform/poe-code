# SafeJS runtime matrix independent audit — 2026-09-15

**OPEN / RELEASE BLOCKED.** Each bounded cell below has dated partial evidence or an explicit blocker. This does not establish complete repaired-feature qualification.

Observed `2026-09-15T05:55:49.077884+00:00`. Source HEAD `ea02a95be39a4dcb2ae2c491b0096a3d26e8c1bb` on main plus existing dirty inputs. Zero changes across the prior per-file source fingerprints (receipt SHA-256 `6550e9ff14ad47028a7c29917c8ec00e115b381055443aa0bb8e3c8d0f9fd4f8`). These are candidate observations, not pristine HEAD qualification. Original staged diff SHA-256 `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8` remains preserved.

Target remains published ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, plus the already tracked Temporal, weak upsert, Atomics.pause and resource-management extensions. No silent target, timeout, budget, authority or support change.

## Manifest-derived bounded release gate

Root engines and generated public package engines are `>=18.18`; SafeJS README advertises Node 18.18+ and ESM. `scripts/package-safe.mjs` uses target `node18.18`. Exact minimum is 18.18.0. Release-safe uses Node 22 on ubuntu-latest; root release uses Node 22 on ubuntu-24.04; PR Bun is pinned 1.3.11, scoped release Bun floats. No OS restriction exists. macOS arm64, Linux x64 and Windows x64 are bounded representatives; other architectures, patch versions and future majors are unsampled, not newly unsupported.

Required entrypoints: canonical `@poe-platform/safe-js` `.`, `/core`, `/cli`, `/workerd`, compatibility `/fs`, `/fs/core`, `/fs/node`; aliases `poe-safejs` and `poe-safe-js`; umbrella `poe-code/safe-js` families and public types. Private workspace `@poe-code/safe-js` is not the installed product.

| Runtime  | Node / ICU / V8                      | macOS arm64: imports; current controls; installed controls         | Linux x64                   | Windows x64                 |
| -------- | ------------------------------------ | ------------------------------------------------------------------ | --------------------------- | --------------------------- |
| v18.18.0 | 18.18.0 / 73.2 / 10.2.154.26-node.26 | 8 pass; 9 pass + weak-symbol failure; 9 pass + weak-symbol failure | BLOCKED: no executed runner | BLOCKED: no executed runner |
| v18.20.8 | 18.20.8 / 74.2 / 10.2.154.26-node.39 | 8 pass; 10 pass; 10 pass; remaining features BLOCKED               | BLOCKED: no executed runner | BLOCKED: no executed runner |
| v20.20.2 | 20.20.2 / 78.2 / 11.3.244.8-node.38  | 8 pass; 10 pass; 10 pass; remaining features BLOCKED               | BLOCKED: no executed runner | BLOCKED: no executed runner |
| v22.23.2 | 22.23.2 / 78.2 / 12.4.254.21-node.56 | 8 pass; 10 pass; 10 pass; remaining features BLOCKED               | BLOCKED: no executed runner | BLOCKED: no executed runner |
| v24.21.0 | 24.21.0 / 78.3 / 13.6.233.17-node.53 | 8 pass; 10 pass; 10 pass; remaining features BLOCKED               | BLOCKED: no executed runner | BLOCKED: no executed runner |
| v26.8.2  | 26.8.2 / 78.3 / 14.6.202.34-node.28  | 8 pass; 10 pass; 10 pass; remaining features BLOCKED               | BLOCKED: no executed runner | BLOCKED: no executed runner |
| bun      | 24.3.0 / 74.2 / 13.6.233.10-node.18  | 8 pass; 10 pass; 10 pass; remaining features BLOCKED               | BLOCKED: no executed runner | BLOCKED: no executed runner |

Bun executable is 1.3.11; Node/V8 compatibility strings above are not evidence that Bun uses V8. Workerd has predecessor dated macOS evidence: version 2026-09-15, compatibility date 2026-09-01, explicit nodejs_compat, real HTTP 200 and six selected controls. Authoritative ICU/V8 build metadata, fresh complete repaired-feature/replay/admission/adapter coverage remain BLOCKED. Linux and Windows Workerd remain BLOCKED: no executed runner. No fresh Workerd run is claimed here.

Intentionally unsupported: Node below 18.18; direct CommonJS require export routes (dynamic import remains ESM); browser-conditioned interpreter/core/CLI/workerd; ambient DOM/process/fetch/general Node APIs, automatic npm resolution and filesystem authority. Explicit host modules/adapters supply authority. Missing authority by design is not an ECMAScript defect. No OS is intentionally excluded.

## Independent manual execution and reproductions

Manual QA: execute the following preserved ten-case probe with each exact runtime against current built index and installed public index; inspect individual failures and actual exits. Execute maintained built-import tests separately. Check manifests, source fingerprints and type contracts before attributing earlier evidence. No screenshot is applicable to this evidence-only change.

Reproduce installed surface in a disposable consumer: `npm init --yes`, then `npm install @poe-platform/safe-js@0.1.605 --ignore-scripts --no-audit --no-fund`. Derive the public index from installed exports; this version resolves to `dist/safe-js/index.js`. Save the following as `probe.mjs`, then execute `<runtime> probe.mjs <index-file-URL>`. Current index is `packages/safe-js/dist/index.js`; build via `npm run build:workspaces -- --workspace=@poe-code/safe-js` first. Current dist already existed; this increment does not claim a fresh build.

```javascript
import assert from "node:assert/strict";
const api = await import(process.argv[2]);
const { run, Budget, lint, createRealm } = api;
console.log(
  JSON.stringify({
    date: new Date().toISOString(),
    entrypoint: process.argv[2],
    versions: process.versions,
    platform: process.platform,
    arch: process.arch
  })
);
let failures = 0;
const cases = [
  [
    "registered-symbol-rejection",
    async () => {
      const r = await run(
        'try { new WeakMap().set(Symbol.for("x"),1);return false; } catch(e) { return e instanceof TypeError; }'
      );
      assert.equal(r.ok, true);
      assert.equal(r.returnValue, true);
    }
  ],
  [
    "fresh-symbol-required",
    async () => {
      const r = await run(
        'const s=Symbol("x");const m=new WeakMap([[s,7]]);return [m.has(s),m.get(s),m.delete(s),m.has(s)];'
      );
      assert.equal(r.ok, true, JSON.stringify(r.error));
      assert.deepEqual(r.returnValue, [true, 7, true, false]);
    }
  ],
  [
    "dynamic-authority-negative",
    async () => {
      const r = await run(
        'return [Function("return typeof process")(),eval("typeof fetch"),typeof require];'
      );
      assert.equal(r.ok, true);
      assert.deepEqual(r.returnValue, ["undefined", "undefined", "undefined"]);
    }
  ],
  [
    "prototype-isolation",
    async () => {
      const r = await run("Object.prototype.matrixMarker=17;return ({}).matrixMarker;");
      assert.equal(r.returnValue, 17);
      assert.equal(Object.prototype.matrixMarker, undefined);
      const next = await run("return ({}).matrixMarker;");
      assert.equal(next.returnValue, undefined);
    }
  ],
  [
    "budget-fatal-unswallowable",
    async () => {
      await assert.rejects(async () => {
        await run("try { while(true){} } catch(e) {} return 1;", {
          budget: new Budget({ maxSteps: 100, maxCallDepth: 20 })
        });
      });
    }
  ],
  [
    "syntax-rejection",
    async () => {
      await assert.rejects(async () => {
        await run("const = 1;");
      });
    }
  ],
  [
    "lint-syntax-negative",
    async () => {
      assert.throws(
        () => lint("const = 1;"),
        (e) => e.code === "ParseError" || e.name === "ParseError"
      );
    }
  ],
  [
    "error-identity",
    async () => {
      const r = await run(
        'try { throw new RangeError("control"); } catch(e) { return [e instanceof Error,e instanceof RangeError,e.message]; }'
      );
      assert.equal(r.ok, true);
      assert.deepEqual(r.returnValue, [true, true, "control"]);
    }
  ],
  [
    "realm-close-revocation",
    async () => {
      const realm = createRealm();
      try {
        assert.equal((await realm.evaluate("return 2;")).returnValue, 2);
      } finally {
        await realm.close();
      }
      await realm.close();
      await assert.rejects(async () => {
        await realm.evaluate("return 3;");
      });
    }
  ],
  [
    "portable-replay-repeated",
    async () => {
      const source = 'const a=[3,1,2];a.sort();return [a.join(","),new Float16Array([1.5])[0]];';
      let r = await run(source);
      assert.equal(r.ok, true);
      assert.deepEqual(r.returnValue, ["1,2,3", 1.5]);
      for (let i = 0; i < 2; i++) {
        const snapshot = api.restore(JSON.parse(await api.dump(r)), { source });
        r = await run(source, { snapshot });
        assert.equal(r.ok, true);
        assert.deepEqual(r.returnValue, ["1,2,3", 1.5]);
      }
    }
  ]
];
for (const [id, fn] of cases) {
  try {
    await fn();
    console.log(JSON.stringify({ id, status: "pass" }));
  } catch (e) {
    failures++;
    console.log(JSON.stringify({ id, status: "fail", error: String(e), stack: e.stack }));
  }
}
process.exitCode = failures ? 1 : 0;
```

**Backend incompatibility leaking into language semantics:** fresh-symbol WeakMap fails on exact minimum in both surfaces with `TypeError: WeakRef: target must be an object`. Minimal guest reproduction: `const s=Symbol(); const m=new WeakMap([[s,7]]); return m.get(s);` requires 7 under edition 16. Native minimum rejects symbol weak keys; guest delegates fresh symbols to native WeakRef. Object-key neighbor and registered-symbol rejection distinguish the backend boundary. Strong retention would change weak ownership; no speculative repair is made. A repair requires maintained failing regression and reachability/replay qualification. Engine floor cannot be raised to erase this defect.

**Packaging:** all eight maintained built-import checks pass on seven runtimes; no packaging failure reproduced in those checks. Installed selected controls use real public 0.1.605, not a current-source tarball. Current installed canonical and umbrella artifacts, complete CLI/type/repaired-feature combinations remain BLOCKED. Import success is not complete artifact qualification.

**Language/recorder mismatch:** use Node `--test` versus Bun `test`; previous wrong Bun syntax and nonexistent consumer filenames were recorder failures, not product packaging defects. Malformed grammar throws ParseError from lint; negative control asserts that contract. This fresh increment uses corrected commands and introduces no recorder skips.

**Maintained manual check:** `npm run typecheck:contracts --workspace=@poe-code/safe-js` exit 0; NodeNext/Bundler × Node-only/DOM each passed 25 cases. Fresh imports: 56 passed, no skips. Fresh ten-case probes: 138 passed, two failures (minimum fresh-symbol on current and installed), no skips.

Prior terminal package gate recorded 2026-09-15: `npm run test --workspace=@poe-code/safe-js`, exit 0, 1451 files passed / 2 skipped; 30806 tests passed / 52 skipped, 2331.07s. Log SHA-256 `dbc7b2c90389362f3be0871e8df8fafcf27a4e0f1be8235278713f14173b16b1`. This is retained predecessor evidence, not a new whole-suite run. Skips remain nonpasses: 2 native Math.f16round comparisons, 5 optional slow disposal, 33 filesystem reference gaps, 7 structured-clone native Instant, 1 optional parser fuzz, 4 native Instant. Prior eight input-error failures did not reproduce in that terminal suite; no timeout or assertion weakened. Cross-runtime whole suites and complete installed repaired-feature mapping remain BLOCKED.

## Exact fresh commands, exits and log fingerprints

- `/Users/kjopek/.npm/_npx/5c21e3f970cab345/node_modules/node/bin/node --test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `0097e48779e895c4023c674288c5ab6f9a7e8ead8f89681d6e4684a84063be1d`.
- `/Users/kjopek/.npm/_npx/5c21e3f970cab345/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 1; output SHA-256 `8806a2c3b44244cc29f0a1c106d428bd0920f6b82fea2f3f172788c6ae46e416`.
- `/Users/kjopek/.npm/_npx/5c21e3f970cab345/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 1; output SHA-256 `0240beebe8ddddda35ca3e3096a1fb176b7605f8a0afefafadb6781e1e100d3c`.
- `/Users/kjopek/.npm/_npx/185e25162edaacfb/node_modules/node/bin/node --test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `9c523707983a580ae177eafc0444da9d673fb36c0efd7a00a10f2388ca848cb3`.
- `/Users/kjopek/.npm/_npx/185e25162edaacfb/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 0; output SHA-256 `b1e229f07b52e1fdfce7ab3ef3a8e46b7d1b4734f61ea37689b95a45b52c78e1`.
- `/Users/kjopek/.npm/_npx/185e25162edaacfb/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 0; output SHA-256 `436be392e809f32ff8e6265f2cb7dad9d0ffb58064673787ad0a99495fe18529`.
- `/Users/kjopek/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node --test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `6b45d83911117c429d8f3d8faf34b383776fae805ead8f80dbe64264bfb2ff9a`.
- `/Users/kjopek/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 0; output SHA-256 `bf703c9e902f1cb1f691aa898bdd8ca90d25d9d5d7497050019fa039c2fabb6b`.
- `/Users/kjopek/.npm/_npx/5dad66f2cb301fc2/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 0; output SHA-256 `17dd2a0435316ddc7a6f916f6fef85970fb116773500ef55a09e23c8db514cee`.
- `/Users/kjopek/.npm/_npx/387698761821791d/node_modules/node/bin/node --test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `c08300a318edecf58e76b9196bfde651b01f15d0ad13138bf71492e4cdac0556`.
- `/Users/kjopek/.npm/_npx/387698761821791d/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 0; output SHA-256 `1690fe833b775f7891c30087fc86aa2c07538b7ec024a262386542ba653a7461`.
- `/Users/kjopek/.npm/_npx/387698761821791d/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 0; output SHA-256 `4d0ee4dab7045461442af4237bfd1d86ce28523c418d8dc31303eaa5b8a9535c`.
- `/Users/kjopek/.npm/_npx/00073ba5d7c1f8bc/node_modules/node/bin/node --test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `bc57fbb847770e8c42c51dcb90408372bc9c7b6abf43964a987878f7246c13c4`.
- `/Users/kjopek/.npm/_npx/00073ba5d7c1f8bc/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 0; output SHA-256 `e914bf59beea8bdefaa2180c138b39ccfaa62fb569b56cc170d8d14d165477fb`.
- `/Users/kjopek/.npm/_npx/00073ba5d7c1f8bc/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 0; output SHA-256 `b701b29104de5a7f04f4cd72f0161d95bba138b18825e0c287468b70b801b707`.
- `/Users/kjopek/.npm/_npx/131005c554cfb1ac/node_modules/node/bin/node --test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `8b4eadbc9a4ed47005ae06f8568e8f924b20290efea2ef614cb48c0fd0a682dc`.
- `/Users/kjopek/.npm/_npx/131005c554cfb1ac/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 0; output SHA-256 `40f1ba687eaef3e893c66388df7e4f7462a6bd27d8162af364427b34e81e10aa`.
- `/Users/kjopek/.npm/_npx/131005c554cfb1ac/node_modules/node/bin/node docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 0; output SHA-256 `8c305445551964a75e592f55190deeb80d2de464ec1261cb0083baaefd918c26`.
- `bun test packages/safe-js/scripts/built-imports.test.mjs`: exit 0; output SHA-256 `eb0d2f86163cf5bc27de0ea2fbc65a22a6fb7307bac7f04fb5bd4f6c03f6b571`.
- `bun docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///Users/kjopek/Workspace/poe-code/packages/safe-js/dist/index.js`: exit 0; output SHA-256 `7645938c1f1e91c0cade93627921ac74046988363624bb4e34b1ecf1427c06b0`.
- `bun docs/plans/runtime-support-20260915/negative-controls/probe-corrected.mjs file:///private/tmp/safejs-runtime-20260915-consumer/node_modules/%40poe-platform/safe-js/dist/safe-js/index.js`: exit 0; output SHA-256 `af1aedec0227c665976629b23ee054ed3c181c747909ca0762165b1b4ab877b5`.

Raw outputs are retained locally in `/tmp/verify-runtime-support-matrix-final/`; temporary logs are not committed artifacts. The probe body, exact commands, metadata, assertions, observed counts and failures above make this report reproducible without those logs.

## Delivery and disposition

Fresh read-only remote main: `55c7d8b1186be5e272595dc6499ec349fa86d833`; not qualified by this candidate. Registry remains 0.1.605, integrity `sha512-bWYNWrXbv/D3IkYnSErQlwmB5hEorbNa+zfIMfxKa0lboztuBqHPmAaBMC47HZFtscQADBo6FFM6sz1PvpQllA==`. Prior scoped publication run 34921860899 identifies predecessor source `6bc5290f862612a79944c105facb408d9e0057b0`; it is not this task publication. No task push or release is claimed. Local evidence commit is reported separately after normal hooks.

Matrix accounting is explicit for all bounded cells. Full compatibility qualification remains incomplete: minimum backend defect, unexecuted Linux/Windows, Workerd metadata and complete feature coverage, other-runtime maintained suites, fresh installed current-source canonical/umbrella coverage and remote delivery/publication. No skipped feature or unavailable runner is a pass. No runtime code repair, README change or support exclusion. Unrelated staged/worktree edits are preserved.
