# F4 published common-boundary composition validation

Date: August 29, 2026. Independent delegated validator: Aquinas.

## Disposition

**The bounded existing native/source/published witnesses pass. Ready for root review, not unconditional full-stack approval.** Additional whole-dump stability comparisons remain failed/open below; they are not relabeled passes or silently accepted restrictions.

- Actual retained npm **poe-code@11.0.32**; runtime source **93dda91e9d0d7078e7940ba51bf73a81ed7aec49**, no overlays.
- **93 runtime subprocesses, 18 named native cases, 124 outcomes**: 18 native, 36 initial source/published, 62 successful completed replays, 4 pending replays, 4 expected old-hook-object resets.
- **102 completed captures and 4 active captures**, indexed with graph/journal identities. Successful completed replays issue **zero host operations and zero resume-provider calls**.
- Native host-observable callback arity **1**, current source **1**, published artifact **1**. The prior native 1/base 0 mismatch is fixed for this witness, not an accepted reflection limitation.
- Passive object/array toJSON hooks **0 calls**; explicit pure host hook requests **1 call**, exact native traces and descriptor observations.
- Old arrays **4 successful replays**; old hook objects **4 exact RESET outcomes before host/provider work**. No historical source/marker/journal/version/snapshot edits.
- No full unit gate rerun. The dependency build selector expanded to **67 successful uncached configured tasks**, larger than anticipated and explicitly recorded.

`evidence/FINAL-atomiccheckpoint.json` records the requested setup checkpoint. No exclusive version window was reserved. Future root-coordinated timed-window and final all-stack decisions remain separate.

## Runtime and artifact identity

Owned clone: `/Users/kjopek/Workspace/poe-code-safejs-final-boundary-composition-review`. Initial authorized fast-forward pull reached `3f996a58ecad69b5a797dbe446a08906797654a7`. Rather than resetting it, execution uses an archive of the exact runtime pin in `out/safejs-final-boundary-composition/work/source`. Installed package project: `out/safejs-final-boundary-composition/work/package`.

F0 manifest SHA-256: `09379aed7eb24e455729e605e53d89408523d731ffe8e8b3655ac76bfe02b674`.

Retained tarball: 15,857,902 bytes; SHA-256 `94aca9a7f6fa9c79e64ac29f88580c4378d285743a7dcb6203a4803d87738ac2`. The root package was installed from that local file, not refetched. All **3,348 installed files** match F0's hash-bound archive inventory. No writable modules/cache are shared with another worker or clone. The two owned install projects use this worker’s owned npm cache; their module trees are separate. Dependency trees, installed lockfile and exact source hashes are captured under `evidence/`.

Actual public export `poe-code/safejs` and its static/literal-dynamic relative import closure:

| File                                            |  Bytes | SHA-256                                                            |
| ----------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `packages/safejs/dist/index.js`                 |  24258 | `e73c331c9db66dbc5c66512e6d217a52d4f78b7089f7c6b0baa484b6014e7ff0` |
| `packages/safejs/dist/chunks/chunk-6EXLQKE5.js` | 268038 | `c925d5a7891e7d277de5ea6fe3faab87df69713a2da81d1ba13401724a522049` |
| `packages/safejs/dist/chunks/chunk-YE6I5W6O.js` | 932732 | `a9de95399b12f6021b01f3bc060425f3f65586086ea21bac7550d1ec2b94dca4` |
| `packages/safejs/dist/chunks/chunk-4YIDX44G.js` |   1592 | `434c775348cd5b060addf31356e4e6ff7abf887f32a30ef81eb3de4ebf9d24a4` |

The inventory uses a TypeScript AST, not private runtime instrumentation. All other published chunks are also in `evidence/installed-artifact-identities.json`. No reproducible source-to-bundle build claim. Source production hashes match the released publisher identity, including TOJSON host-call and the arity bridge. Source entry is `packages/safejs/src/index.ts`. Arity/ARG drivers import the verified installed export target by file URL; HOST/Map/TOJSON import `poe-code/safejs` directly.

## Provenance and capability boundary

Ancestor/root AGENTS were read. Root orchestrates; this worker executes directly. Guard: **exactly 38 exclusions plus the entire security directory**, empty original-payload allowlist, **zero original audit payload reads**. Inputs are approved captured benign witnesses and bounded publisher command indexes; no original archive search, security research, new probe matrix, native-function forging, private bundle instrumentation, guest real IO or LLM calls.

Seven pinned manifests (F0, TOJSON, arity, Map, HOST, ARG, H5) are under `inputs/manifests`; exact pins are in `inputs/manifest-pins.json`. Publisher receipt, released-runtime identity and four original command indexes are under `inputs/publisher`. Prior results supply provenance, not substitute for this run.

H3 chronology remains qualified: **443 reported initial reads, 73 surviving safe envelopes, 369 durable recovery records**. Lost initial chronology is not reconstructed/certified.

Hosts are bounded pure data/callback stubs. Driver-level file reads consume reviewer-controlled stdin or captured replay JSON only; no guest filesystem/network capability. Measured descriptors cover these ordinary own-data witnesses: field order, enumerable/configurable/writable flags, metadata aliases, hook presence and function length descriptors. No claim that the entire converter never invokes getters; no new accessor/security matrix.

## Setup recipe

Use a newly owned clean main clone, pull first, then archive the pin. Preserve all old clones. Exact setup commands/outputs are in `evidence/install-published.json`, `evidence/install-source.json`, `evidence/build-source-dependencies.json` and `evidence/environment.json`. Provision the owned directories and a private installation package.json before these commands.

```sh
export F4_ROOT="$PWD/out/safejs-final-boundary-composition"
export SKIP_SYNC_SKILLS=1 HUSKY=0 TURBO_TELEMETRY_DISABLED=1
export POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error
export npm_config_update_notifier=false
export HOME="$F4_ROOT/work/home" TMPDIR="$F4_ROOT/work/tmp"
export XDG_CACHE_HOME="$F4_ROOT/work/cache" XDG_CONFIG_HOME="$F4_ROOT/work/config"
export npm_config_cache="$F4_ROOT/work/cache/npm"
export npm_config_userconfig="$F4_ROOT/work/config/npmrc"
unset TERM
git archive 93dda91e9d0d7078e7940ba51bf73a81ed7aec49 | tar -xf - -C "$F4_ROOT/work/source"
(cd "$F4_ROOT/work/package" && npm install --no-audit --no-fund "$F4_ROOT/inputs/poe-code-11.0.32.tgz")
(cd "$F4_ROOT/work/source" && npm ci --no-audit --no-fund)
(cd "$F4_ROOT/work/source" && node_modules/.bin/turbo run build '--filter=@poe-code/safejs^...' --concurrency=1)
```

Node `v22.22.2`; npm `10.9.7`. Both public import checks pass. Build outputs stay in the owned projection. No tracked regular source differs; the tracked CLAUDE symlink matches its Git link bytes. No timeout override, skill sync, production/README edit, commit or push.

## Cases and exact full oracles

`evidence/native-oracles.json` contains every full source, native return, host observation/event and callback trace; SHA-256 `a9f6d38f76e81d415f933e2bcd2bd48aed21e611679853304c66d81598fc8f25`. These are complete field-level oracles, not labels. Two TOJSON source texts each have passive and explicit host profiles, so 18 named cases are not 18 distinct source texts.

| Family / case            | Source SHA-256                                                     |
| ------------------------ | ------------------------------------------------------------------ |
| arity / aliases          | `e70d49b6b5d39d93a01d91e3320ce938ed04545c93e5d379645cd7ee9cf31177` |
| arity / before-host      | `a863ed3854c1542ba0385e4175588da8c2eccaafdab5217357a05c1162f74e94` |
| arity / bound            | `fc5e31c878a29f6ba42e81be5e74af7afe32ac32c4b040296d9e81f5ae814adb` |
| arity / exact            | `17a1e1390a0a6a9562fe4efb06a45f72874dd64d5aa67360df85fe69346477b5` |
| arity / nested           | `2dd86109b8987f08bbb632732165cdeda54252d0748feebe03277bfca239e161` |
| arity / proof-context    | `6f8fcd1f78dc0306789b09bf10c48aac1a46caaf07ff06efd2be8e233d0a10ee` |
| arity / sparse           | `3829a222fc18eab9094c13051a9e100eeb6ad5c17fec993459d2dcb191717b58` |
| host / callback-argument | `0c74c27eb7d7f874221d3678432fee8f8303801115ecd41969ee7d00ceadff9b` |
| host / callback-result   | `ece29af1f6100dc214f59ee2455d24a30f223b97cc31ee8debf7cd2839091cfe` |
| host / exact-minimal     | `3fb9ddd0dd77a7459797af4ab8dc9479159083ef609700b33207c19d417e82bc` |
| host / host-result       | `4d099d00532489115f93493000e81d28c9c0cbba94ae033f0aa4f6498cf38939` |
| map / capturedSource     | `fee18fa1cb868e0ee313393032be182b9835b1b4be6f7f1b3cc036b5e0406a38` |
| map / collectionSource   | `c47508af1a5eb3bf65c6ba389b4697c5a63b4e36aeb4e6d12f4f33c7e363725e` |
| arg / minimal            | `88594bc2837f8daccb1f10ee63e0b975404e27b1e95c2c187acb1493c2e97af6` |
| tojson / plain-passive   | `bf2e3900c00e474516123ebad093633fdc57e62cdefb525a01268ead96b76e86` |
| tojson / array-passive   | `d13a4a24ccb82818a6c5ad4a0821180f5cd6e96e658896d4bc5537f3ad35707d` |
| tojson / plain-explicit  | `bf2e3900c00e474516123ebad093633fdc57e62cdefb525a01268ead96b76e86` |
| tojson / array-explicit  | `d13a4a24ccb82818a6c5ad4a0821180f5cd6e96e658896d4bc5537f3ad35707d` |

Arity covers default/rest/bound/async-supported syntax, nested callbacks, wrapper aliases, sparse arguments, genuine active proof context and pending-before-host restore. HOST covers minimal callback result, callback-result graph, callback-argument graph and host-result graph. Map covers closure/Map/Set aliases, cycles and sparse rows. ARG's exact minimal source is `const values = [1]; values.map = 0; return host(values);` with native/current result 1. No new witness matrix.

## Agent-executed procedure

This Markdown is the procedure, not a standalone QA script. `evidence/command-index.json` indexes each actual receipt with exact argv/cwd/stdin/stdout/stderr/exit status and inline program. Source uses `node --import tsx --input-type=module -e '<program>'` from the source projection. Native and installed package use `node --input-type=module -e '<program>'`, with installed cases in the isolated package cwd. Keep the owned environment and TERM unset.

1. Inspect the selected input's pure capability requirements, run native first, and compare every field to the frozen full oracle.
2. Run unchanged source against source public entry and actual installed export. Preserve synchronous hosts for synchronous arity/ARG sources. Require native-equal return, actual host descriptor/arity observations, alias checks, callback trace and counts.
3. Call public `dump(result)`, or TOJSON `dump(result,{mode:"replay"})`, and retain the newly returned capture. Do not substitute a historical snapshot for a fresh capture.
4. In a **fresh process**, use public `restore(JSON.parse(capture),{source})` and `run(source,{snapshot,bindings,hostCallResumeProvider})`. Completed host/provider stubs throw if invoked. Compare full return and typed replay journal, exact capability/callback IDs, digests, alias edges and sparse descriptors. HOST and minimal ARG run two fresh restores of the initial current capture; Map chains two successive fresh restores. Never remap IDs, deduplicate nodes, erase fields or repair old captures.
5. Arity before-host/proof-context uses the existing deferred gate and active `dump(execution,{mode:"replay"})` before release. Fresh pending before-host issues the still-unexecuted host once and measures arities 2/1. Proof-context issues no host, invokes the genuine provider once and observes its genuine restored callback length 1. Each reissues the gate once. These are distinct from completed-replay zero-work claims.
6. TOJSON preserves four profiles: native-equal descriptors and before/after host data; passive hook count 0, explicit count 1. Replay all eight new source/package captures on both entries (16 outcomes). Replay four exact historical ARG captures on both entries (8 outcomes). Old arrays preserve full data/journal/capture; old plain-hook objects produce the exact captured public RESET error before external work. Do not auto-reset/reissue or claim universal migration.
7. Check original raw captures and preserve failed additional whole-dump comparisons as well as passing original native/typed-graph assertions. Do not invent historical acceptance.

To rerun one recorded invocation in the same owned environment, inspect its receipt first, then execute the inline block below. For a **new** replay chain, replace only that invocation's in-memory snapshot/serialized input with the newly generated capture; never edit the frozen receipt. TOJSON new input rows use the current exact publicCapture.snapshot, publicState.hostCalls and unchanged native oracle; historical rows remain verbatim.

```sh
export RECEIPT="$F4_ROOT/runtime/arity/green-source-exact.json"
node --input-type=module <<'JS'
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const receipt = JSON.parse(fs.readFileSync(process.env.RECEIPT, 'utf8'));
const owned = JSON.parse(fs.readFileSync(process.env.F4_ROOT + '/evidence/environment.json', 'utf8'));
const environment = {...process.env, ...owned, ...(receipt.environment ?? {})};
delete environment.TERM;
const result = spawnSync(receipt.argv[0], receipt.argv.slice(1), {
  cwd: receipt.cwd, env: environment, input: receipt.stdin,
  encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
assert.equal(result.status, 0);
JS
```

The 60-second parent subprocess bound does not override configured runtime/unit timeouts. Original witness budgets and finite deferred/microtask controls remain unchanged. Receipts give actual newly executed argv, never invented historical argv.

### Inline public API programs

These are the actual reviewed inline programs, not old standalone QA scripts. Executed Arity/HOST/Map/ARG program bytes are unchanged; Markdown code blocks are formatter-rendered views, while exact bytes remain in the cited receipts. TOJSON changes only its package import from private workspace `@poe-code/safejs` to actual published `poe-code/safejs`; both hashes are in `evidence/tojson-driver-adaptation.json`. Guest source, host behavior, original assertions and budgets are unchanged.

#### Arity and active proof

Receipt: `runtime/arity/native-exact.json`; program SHA-256 `33ba0f0def3bea0c8d138edc37da7ee475ee53572e030d8752c7948789fca386`.

```js
import { pathToFileURL } from "node:url";
const input = JSON.parse(process.argv[1]),
  item = input.case;
const counts = { host: 0, gate: 0, provider: 0 },
  hostObservations = [],
  proofObservations = [],
  trace = [];
function deferred() {
  let resolve;
  const promise = new Promise((release) => {
    resolve = release;
  });
  return { promise, resolve };
}
async function bounded(promise) {
  let done = false,
    value,
    error,
    failed = false;
  promise.then(
    (result) => {
      done = true;
      value = result;
    },
    (reason) => {
      done = true;
      failed = true;
      error = reason;
    }
  );
  for (let turn = 0; turn < 8192 && !done; turn++) await Promise.resolve();
  if (!done) throw Error("Finite notification exhausted");
  if (failed) throw error;
  return value;
}
const entered = deferred(),
  waiting = deferred();
const describe = (callback) => {
  if (typeof callback !== "function") throw Error("Expected genuine callback");
  return {
    length: callback.length,
    descriptor: Object.getOwnPropertyDescriptor(callback, "length")
  };
};
const graphObserver = item.observation ? new Function("values", item.observation) : null;
async function invoke(callback, args) {
  trace.push({ event: "callback-call", args });
  const result = await callback(...args);
  trace.push({ event: "callback-result", result });
  return result;
}
function host(...args) {
  counts.host++;
  if (input.phase === "completed" || (input.phase === "pending" && item.id === 5))
    throw Error("Host unexpectedly reissued");
  if (item.id === 0) {
    const values = args[0],
      callback = Object.getOwnPropertyDescriptor(values, "map").value;
    hostObservations.push({ keys: Object.keys(values), ...describe(callback) });
    return 1;
  }
  if (item.id === 1) {
    hostObservations.push(args.map(describe));
    return args.map((callback) => callback.length);
  }
  if (item.id === 2)
    return (async () => {
      const values = args[0],
        callback = values[0],
        metadata = Object.getOwnPropertyDescriptor(values, "metadata").value;
      const observed = {
        ...describe(callback),
        aliases: [
          callback === values[1],
          callback === Object.getOwnPropertyDescriptor(values, "map").value,
          callback === metadata.alias,
          Object.getOwnPropertyDescriptor(values, "raw").value === values
        ]
      };
      hostObservations.push({ ...observed, keys: Object.keys(values) });
      return {
        ...observed,
        results: [await invoke(callback, [3]), await invoke(callback, [4, 5, 6])]
      };
    })();
  if (item.id === 3)
    return (async () => {
      const callback = args[0],
        value = await invoke(callback, [7]),
        target = value.target,
        bound = value.bound;
      const observed = {
        outer: describe(callback),
        target: describe(target),
        bound: describe(bound),
        alias: target === value.alias
      };
      hostObservations.push(observed);
      return [
        callback.length,
        target.length,
        bound.length,
        target === value.alias,
        await invoke(target, [3, 4]),
        await invoke(bound, [5])
      ];
    })();
  if (item.id === 4)
    return (async () => {
      const [target, bound] = args;
      hostObservations.push({ target: describe(target), bound: describe(bound) });
      return [target.length, bound.length, await invoke(target, [3, 4]), await invoke(bound, [5])];
    })();
  if (item.id === 5) {
    hostObservations.push(describe(args[0]));
    return invoke(args[0], [3, 4]);
  }
  const values = args[0];
  hostObservations.push(graphObserver(values));
  Object.defineProperty(values, "cycle", { value: values, enumerable: true });
  return values;
}
function gate() {
  counts.gate++;
  if (input.capturePending) {
    entered.resolve();
    return waiting.promise;
  }
  return Promise.resolve(undefined);
}
try {
  let value, capture, pendingCapture;
  if (input.entry === "native") {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    value = await new AsyncFunction("host", "gate", item.source)(host, gate);
  } else {
    const api = await import(pathToFileURL(input.entry).href);
    const options = {
      bindings: {
        host: api.declareHostOperation(host, "read-side-effect"),
        gate: api.declareHostOperation(gate, "re-issue")
      },
      hostCallResumeProvider: async (request, context) => {
        counts.provider++;
        if (item.id !== 5 || input.phase !== "pending" || !context || context.callbacks.size !== 1)
          throw Error("Unexpected provider");
        for (const callback of context.callbacks.values())
          proofObservations.push(describe(callback));
        const value = await context.replayed[0].result;
        return {
          ...request,
          callbackDisposition: "joined",
          outcome: { status: "fulfilled", value: context.toSandboxValue(value) }
        };
      }
    };
    if (input.snapshot)
      options.snapshot = api.restore(JSON.parse(input.snapshot), { source: item.source });
    const execution = api.run(item.source, options);
    let result;
    if (input.capturePending) {
      try {
        await bounded(
          Promise.race([
            entered.promise,
            execution.then(() => {
              throw Error("Expected pending gate");
            })
          ])
        );
        pendingCapture = await bounded(api.dump(execution, { mode: "replay" }));
      } finally {
        waiting.resolve();
        result = await bounded(execution);
      }
    } else result = await execution;
    if (!result.ok) throw Error("Application error: " + JSON.stringify(result));
    value = api.deepCopyFromSandbox(result.returnValue);
    capture = await api.dump(result);
  }
  console.log(
    JSON.stringify({
      pid: process.pid,
      ok: true,
      observation: graphObserver ? graphObserver(value) : value,
      hostObservations,
      proofObservations,
      trace,
      counts,
      capture,
      pendingCapture
    })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      pid: process.pid,
      ok: false,
      counts,
      hostObservations,
      proofObservations,
      trace,
      error: { name: error.name, message: error.message, stack: error.stack }
    })
  );
  process.exitCode = 1;
}
```

#### Array boundary graphs

Receipt: `runtime/host/exact-minimal-native.json`; program SHA-256 `897a5297e17663d6587bd7d76b5a0ee83d0567637b918ea70716af7c0e46cd0e`.

```js
import fs from "node:fs";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const makeGraph = new Function(input.graphSetup + " return graph;");
const observeGraph = new Function("graph", input.graphObservation);
const hostObservations = [];
async function invoke(...args) {
  if (input.flow === "host-result") return makeGraph();
  const callback = args[0];
  assert.equal(typeof callback, "function");
  if (input.flow === "callback-argument") return callback(makeGraph());
  const value = await callback();
  hostObservations.push(
    input.flow === "minimal"
      ? [
          Object.keys(value),
          Object.hasOwn(value, "metadata"),
          Object.getOwnPropertyDescriptor(value, "metadata")?.value === 7
        ]
      : observeGraph(value)
  );
  return value;
}
if (input.mode === "native") {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const value = await new AsyncFunction("host", input.source)(invoke);
  assert.deepEqual(value, input.expected);
  console.log(
    JSON.stringify({
      pid: process.pid,
      mode: input.mode,
      caseName: input.name,
      value,
      hostObservations
    })
  );
} else {
  const entry = input.mode === "built" ? "poe-code/safejs" : "./packages/safejs/src/index.ts",
    api = await import(entry);
  let hosts = 0,
    providers = 0;
  const restoring = input.serialized !== undefined;
  const result = await api.run(input.source, {
    bindings: {
      host: api.declareHostOperation(async (...args) => {
        hosts++;
        assert.equal(restoring, false, "completed host reissued");
        return invoke(...args);
      }, "read-side-effect")
    },
    hostCallResumeProvider: () => {
      providers++;
      throw Error("completed provider requested");
    },
    budget: new api.Budget({
      maxSteps: 10000,
      arrayLength: 128,
      stringLength: 4096,
      dataSize: 200000,
      maxCallDepth: 64
    }),
    ...(restoring
      ? { snapshot: api.restore(JSON.parse(input.serialized), { source: input.source }) }
      : {})
  });
  assert.equal(result.ok, true);
  const value = api.deepCopyFromSandbox(result.returnValue);
  const comparable = Array.isArray(value) ? value : Object.entries(value);
  const expected = Array.isArray(input.expected) ? input.expected : Object.entries(input.expected);
  const serialized = await api.dump(result);
  assert.equal(hosts, restoring ? 0 : 1);
  assert.equal(providers, 0);
  console.log(
    JSON.stringify({
      pid: process.pid,
      mode: input.mode,
      entry: import.meta.resolve(entry),
      caseName: input.name,
      restoring,
      value,
      returnNullPrototype: Object.getPrototypeOf(value) === null,
      matchesNative: isDeepStrictEqual(comparable, expected),
      hosts,
      providers,
      hostObservations,
      serialized,
      serializedBytes: Buffer.byteLength(serialized),
      serializedSha256: createHash("sha256").update(serialized).digest("hex")
    })
  );
}
```

#### Map closure graphs

Receipt: `runtime/map/capturedSource-native-0.json`; program SHA-256 `d4301a00c54e18998c0e4da90559c2fe45b6ef362e7c9f2d592f4b7ef7044366`.

```js
import fs from "node:fs";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
const input = JSON.parse(fs.readFileSync(0, "utf8"));
if (input.mode === "native") {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const value = await new AsyncFunction("host", "gate", input.source)(
    async (callback) => callback(),
    async () => undefined
  );
  assert.deepEqual(value, input.expected);
  console.log(JSON.stringify({ pid: process.pid, mode: input.mode, name: input.name, value }));
} else {
  const entry = input.mode === "built" ? "poe-code/safejs" : "./packages/safejs/src/index.ts";
  const api = await import(entry);
  let hosts = 0,
    gates = 0,
    providers = 0;
  let serialized = input.serialized;
  const observations = [];
  for (let round = 0; round < input.rounds; round++) {
    const restoring = serialized !== undefined;
    const result = await api.run(input.source, {
      bindings: {
        host: api.declareHostOperation(async (callback) => {
          hosts++;
          assert.equal(restoring, false, "completed host reissued");
          return callback();
        }, "read-side-effect"),
        gate: api.declareHostOperation(async () => {
          gates++;
          assert.equal(restoring, false, "completed gate reissued");
          return undefined;
        }, "re-issue")
      },
      hostCallResumeProvider: () => {
        providers++;
        throw Error("completed provider requested");
      },
      budget: new api.Budget({
        maxSteps: 10000,
        arrayLength: 128,
        stringLength: 4096,
        dataSize: 200000,
        maxCallDepth: 64
      }),
      ...(restoring
        ? { snapshot: api.restore(JSON.parse(serialized), { source: input.source }) }
        : {})
    });
    assert.equal(result.ok, true);
    const value = api.deepCopyFromSandbox(result.returnValue);
    serialized = await api.dump(result);
    observations.push({
      round,
      restoring,
      value,
      returnNullPrototype: Object.getPrototypeOf(value) === null,
      matchesNative: isDeepStrictEqual(Object.entries(value), Object.entries(input.expected)),
      hosts,
      gates,
      providers,
      serialized,
      serializedBytes: Buffer.byteLength(serialized),
      serializedSha256: createHash("sha256").update(serialized).digest("hex")
    });
  }
  assert.equal(providers, 0);
  assert.equal(hosts, input.serialized === undefined ? 1 : 0);
  assert.equal(gates, input.serialized === undefined ? 1 : 0);
  console.log(
    JSON.stringify({
      pid: process.pid,
      mode: input.mode,
      entry: import.meta.resolve(entry),
      name: input.name,
      observations
    })
  );
}
```

#### Minimal own map shadow

Receipt: `runtime/arg/native-minimal.json`; program SHA-256 `09a7aba8fdfdeaef068f152c5cc188eef9e86b2abdb3604c83e49a229a6aabae`.

```js
import { pathToFileURL } from "node:url";
const input = JSON.parse(process.argv[1]);
let hostCalls = 0,
  providerCalls = 0;
const argumentsObserved = [];
const observe = input.case.observation ? new Function("values", input.case.observation) : null;
const host = (values) => {
  hostCalls++;
  if (input.snapshot) throw Error("Completed host reissued");
  if (observe) {
    argumentsObserved.push(observe(values));
    Object.defineProperty(values, "cycle", { value: values, enumerable: true });
    return values;
  }
  argumentsObserved.push({
    keys: Object.keys(values),
    mapType: typeof values.map,
    mapLength: typeof values.map === "function" ? values.map.length : null,
    mapValue: typeof values.map === "function" ? null : values.map
  });
  return 1;
};
try {
  let result, capture;
  if (input.entry === "native") {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    result = await new AsyncFunction("host", input.case.source)(host);
  } else {
    const api = await import(pathToFileURL(input.entry).href);
    const bindings = { host: api.declareHostOperation(host, "read-side-effect") };
    const options = {
      bindings,
      hostCallResumeProvider: () => {
        providerCalls++;
        throw Error("Completed provider invoked");
      }
    };
    if (input.snapshot)
      options.snapshot = api.restore(JSON.parse(input.snapshot), { source: input.case.source });
    const outcome = await api.run(input.case.source, options);
    if (!outcome.ok) throw Error("Unexpected application error: " + JSON.stringify(outcome));
    result = api.deepCopyFromSandbox(outcome.returnValue);
    capture = await api.dump(outcome);
  }
  console.log(
    JSON.stringify({
      pid: process.pid,
      ok: true,
      observation: observe ? observe(result) : result,
      argumentsObserved,
      hostCalls,
      providerCalls,
      capture
    })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      pid: process.pid,
      ok: false,
      hostCalls,
      providerCalls,
      argumentsObserved,
      error: { name: error.name, message: error.message, stack: error.stack }
    })
  );
}
```

#### Passive and explicit hooks

Receipt: `runtime/tojson/initial-native.json`; program SHA-256 `7a03bbe2be3311b7ef50f07bf7bc8cde41a15cf16963cda741d3e459ddd81851`.

```js
const mode = process.env.TOJSON_MODE;
const selection = process.env.TOJSON_SELECTION ?? "all";
const api =
  mode === "native"
    ? undefined
    : await import(mode === "built" ? "poe-code/safejs" : "./packages/safejs/src/index.ts");
const definitions = [
  { id: "plain-passive", array: false, explicit: false },
  { id: "array-passive", array: true, explicit: false },
  { id: "plain-explicit", array: false, explicit: true },
  { id: "array-explicit", array: true, explicit: true }
].filter((definition) => selection === "all" || !definition.explicit);
const describeError = (error) => ({
  name: error?.name ?? null,
  message: error?.message ?? String(error),
  stack: error?.stack ?? null,
  code: error?.code ?? null,
  budget: error?.budget ?? null,
  current: error?.current ?? null,
  limit: error?.limit ?? null
});
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(
        (value) => ({ status: "fulfilled", value }),
        (error) => ({ status: "rejected", error: describeError(error) })
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout", label, milliseconds }), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function observeArgument(payload) {
  const descriptors = Object.getOwnPropertyDescriptors(payload);
  const metadata = descriptors.metadata.value;
  return {
    array: Array.isArray(payload),
    descriptors: Object.entries(descriptors).map(([key, descriptor]) => ({
      key,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
      writable: descriptor.writable,
      valueType: typeof descriptor.value,
      data: Object.hasOwn(descriptor, "value")
    })),
    marker: descriptors.marker.value,
    scalar: descriptors[Array.isArray(payload) ? "0" : "value"].value,
    metadata: {
      label: Object.getOwnPropertyDescriptor(metadata, "label").value,
      rank: Object.getOwnPropertyDescriptor(metadata, "rank").value
    },
    metadataAlias: descriptors.alias.value === metadata,
    ownHook: Object.hasOwn(descriptors, "toJSON"),
    hookType: typeof descriptors.toJSON.value
  };
}
const results = [];
for (const definition of definitions) {
  const source = [
    "let count = 0;",
    "const trace = [];",
    definition.array ? "const payload = [7];" : "const payload = { value: 7 };",
    'payload.marker = "retained";',
    'payload.metadata = { label: "unchanged", rank: 3 };',
    "payload.alias = payload.metadata;",
    'payload.toJSON = (reason) => { count += 1; trace.push({ event: "hook", reason, ordinal: count }); return { hookResult: "done", ordinal: count }; };',
    'trace.push({ event: "before-host" });',
    "const hostResult = await host(payload);",
    'trace.push({ event: "after-host" });',
    'return { count, trace, hostResult, hookPresent: typeof payload.toJSON === "function", marker: payload.marker, metadataAlias: payload.alias === payload.metadata };'
  ].join("\n");
  const hostEvents = [];
  let hostCalls = 0;
  let providerCalls = 0;
  const host = async (payload) => {
    hostCalls += 1;
    hostEvents.push({ event: "host-enter", ordinal: hostCalls });
    const before = observeArgument(payload);
    let hookResult = null;
    if (definition.explicit) {
      hostEvents.push({ event: "host-request-hook" });
      const hook = Object.getOwnPropertyDescriptor(payload, "toJSON").value;
      hookResult = await Reflect.apply(hook, payload, ["host-request"]);
      hostEvents.push({ event: "host-hook-returned", hookResult });
    }
    const after = observeArgument(payload);
    hostEvents.push({ event: "host-exit", ordinal: hostCalls });
    return { acknowledgment: "host-done", before, after, hookResult };
  };
  const controller = new AbortController();
  const budget =
    api === undefined
      ? undefined
      : new api.Budget({
          maxSteps: 100000,
          maxCallDepth: 40,
          stringLength: 20000,
          arrayLength: 1000,
          dataSize: 1000000,
          deadline: Date.now() + 2500
        });
  const execution =
    api === undefined
      ? new (Object.getPrototypeOf(async function () {}).constructor)("host", source)(host)
      : api.run(source, {
          bindings: { host: api.declareHostOperation(host, "read-side-effect") },
          budget,
          randomSeed: 17,
          signal: controller.signal,
          hostCallResumeProvider: () => {
            providerCalls += 1;
            throw new Error("Unexpected provider request in fresh baseline");
          }
        });
  const settled = await bounded(execution, 3000, definition.id + " execution");
  const observation = {
    id: definition.id,
    mode,
    source,
    expectedNativeHookCalls: definition.explicit ? 1 : 0,
    expectedNativeHostCalls: 1,
    execution: { status: settled.status },
    hostCalls,
    providerCalls,
    hostEvents
  };
  if (settled.status === "fulfilled") {
    if (api === undefined) observation.execution.returnValue = settled.value;
    else {
      const result = settled.value;
      observation.execution.ok = result.ok;
      if (result.ok)
        observation.execution.returnValue = api.deepCopyFromSandbox(result.returnValue);
      else observation.execution.error = describeError(result.error);
      const snapshot = result.snapshot;
      observation.publicState = {
        pendingAwaits: snapshot.pendingAwaits ?? [],
        replayError: snapshot.replayError ?? null,
        promiseReplay: snapshot.promiseReplay ?? null,
        replay: snapshot.replay ?? null,
        hostCalls:
          snapshot.hostCalls?.map((record) => ({
            ...record,
            ...(record.outcome === undefined
              ? {}
              : {
                  outcome:
                    record.outcome.status === "fulfilled"
                      ? {
                          status: "fulfilled",
                          value: api.deepCopyFromSandbox(record.outcome.value)
                        }
                      : {
                          status: "rejected",
                          reason: api.deepCopyFromSandbox(record.outcome.reason)
                        }
                })
          })) ?? []
      };
      const captured = await bounded(
        api.dump(result, { mode: "replay" }),
        1000,
        definition.id + " completed dump"
      );
      observation.publicCapture =
        captured.status === "fulfilled"
          ? { status: captured.status, snapshot: JSON.parse(captured.value) }
          : captured;
    }
  } else {
    observation.execution = settled;
    if (api !== undefined) {
      const captured = await bounded(
        api.dump(execution, { mode: "replay" }),
        1000,
        definition.id + " pending dump"
      );
      observation.publicCapture =
        captured.status === "fulfilled"
          ? { status: captured.status, snapshot: JSON.parse(captured.value) }
          : captured;
      controller.abort();
      observation.ownRunAbortAfterBound = true;
      observation.afterAbort = await bounded(
        execution,
        500,
        definition.id + " own-run cleanup"
      ).then((value) => ({ status: value.status, ...(value.error ? { error: value.error } : {}) }));
    }
  }
  observation.hostCalls = hostCalls;
  observation.providerCalls = providerCalls;
  observation.counterMatchesNative =
    observation.execution.returnValue?.count === observation.expectedNativeHookCalls;
  observation.hostCountMatchesNative = hostCalls === 1;
  if (budget !== undefined)
    observation.budget = {
      stepsUsed: budget.stepsUsed,
      currentCallDepth: budget.currentCallDepth,
      peakCallDepth: budget.peakCallDepth,
      currentDataSize: budget.currentDataSize,
      peakDataSize: budget.peakDataSize
    };
  results.push(observation);
}
console.log(JSON.stringify({ mode, selection, cases: results }, null, 2));
process.exitCode = results.every(
  (result) => result.counterMatchesNative && result.hostCountMatchesNative
)
  ? 0
  : 1;
```

#### Fresh and historical hook replays

Receipt: `runtime/tojson/fresh-replay-source.json`; program SHA-256 `5547c52208c6dcdb4852242968b8d2d37ba3cffc9f3e2029d0cb4bc04690a65c`.

```js
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const mode = process.env.TOJSON_MODE;
const api = await import(mode === "built" ? "poe-code/safejs" : "./packages/safejs/src/index.ts");
const inputs = JSON.parse(readFileSync(process.env.TOJSON_REPLAY_INPUT, "utf8")).cases;
const describeError = (error) => ({
  name: error?.name ?? null,
  message: error?.message ?? String(error),
  stack: error?.stack ?? null,
  code: error?.code ?? null,
  action: error?.action ?? null,
  callId: error?.callId ?? null,
  lifecycle: error?.lifecycle ?? null
});
async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(
        (value) => ({ status: "fulfilled", value }),
        (error) => ({ status: "rejected", error: describeError(error) })
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout", milliseconds }), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const results = [];
for (const input of inputs) {
  let hostCalls = 0;
  let providerCalls = 0;
  const controller = new AbortController();
  const outcome = {
    id: input.id,
    kind: input.kind,
    caseId: input.caseId,
    expectedDisposition: input.expectedDisposition
  };
  try {
    const restored = api.restore(input.snapshot, { source: input.source });
    const execution = api.run(input.source, {
      snapshot: restored,
      signal: controller.signal,
      bindings: {
        host: api.declareHostOperation(async () => {
          hostCalls += 1;
          throw new Error("Completed replay must not reissue host");
        }, "read-side-effect")
      },
      hostCallResumeProvider: () => {
        providerCalls += 1;
        throw new Error("Completed replay must not request proof");
      }
    });
    const settled = await bounded(execution, 3000);
    outcome.executionStatus = settled.status;
    if (settled.status === "fulfilled") {
      const result = settled.value;
      outcome.ok = result.ok;
      if (result.ok) outcome.returnValue = api.deepCopyFromSandbox(result.returnValue);
      else outcome.error = describeError(result.error);
      outcome.publicState = {
        pendingAwaits: result.snapshot.pendingAwaits ?? [],
        promiseReplay: result.snapshot.promiseReplay ?? null,
        replayError: result.snapshot.replayError ?? null,
        replay: result.snapshot.replay ?? null,
        hostCalls:
          result.snapshot.hostCalls?.map((record) => ({
            ...record,
            ...(record.outcome === undefined
              ? {}
              : {
                  outcome:
                    record.outcome.status === "fulfilled"
                      ? {
                          status: "fulfilled",
                          value: api.deepCopyFromSandbox(record.outcome.value)
                        }
                      : {
                          status: "rejected",
                          reason: api.deepCopyFromSandbox(record.outcome.reason)
                        }
                })
          })) ?? []
      };
      const captured = await bounded(api.dump(result, { mode: "replay" }), 1000);
      outcome.publicCapture =
        captured.status === "fulfilled"
          ? { status: captured.status, snapshot: JSON.parse(captured.value) }
          : captured;
      outcome.journalMatchesOriginal = isDeepStrictEqual(
        JSON.parse(JSON.stringify(outcome.publicState.hostCalls)),
        input.originalJournal
      );
      outcome.fullCaptureMatchesOriginal =
        outcome.publicCapture.status === "fulfilled" &&
        isDeepStrictEqual(outcome.publicCapture.snapshot, input.snapshot);
      outcome.returnPrototypeObservation = {
        actualNullPrototype: result.ok && Object.getPrototypeOf(outcome.returnValue) === null,
        recordedOracleNullPrototype: Object.getPrototypeOf(input.expectedReturn) === null
      };
    } else if (settled.status === "rejected") outcome.error = settled.error;
    else {
      controller.abort();
      outcome.ownRunAbortAfterBound = true;
    }
  } catch (error) {
    outcome.executionStatus = "rejected";
    outcome.error = describeError(error);
  }
  outcome.hostCalls = hostCalls;
  outcome.providerCalls = providerCalls;
  outcome.fullReturnMatchesNative =
    outcome.returnValue !== undefined &&
    isDeepStrictEqual(JSON.parse(JSON.stringify(outcome.returnValue)), input.expectedReturn);
  const callLines = input.source.split("\n");
  const callLine = callLines.findIndex((line) => line.includes("host(payload)"));
  const resetMessage =
    "Host call " +
    input.originalJournal[0].id +
    " does not match the next restored invocation; reset is required.";
  const expectedPublicReset = {
    name: "Error",
    message: resetMessage,
    stack:
      "Error: " +
      resetMessage +
      "\n    at host (line " +
      (callLine + 1) +
      ", column " +
      (callLines[callLine].indexOf("host(payload)") + 1) +
      ")",
    code: null,
    action: null,
    callId: null,
    lifecycle: null
  };
  outcome.publicResetMatchesExact = isDeepStrictEqual(outcome.error, expectedPublicReset);
  outcome.matchesExpectedDisposition =
    input.expectedDisposition === "reset"
      ? outcome.executionStatus === "rejected" &&
        outcome.publicResetMatchesExact &&
        hostCalls === 0 &&
        providerCalls === 0
      : outcome.ok === true &&
        outcome.fullReturnMatchesNative &&
        outcome.journalMatchesOriginal &&
        outcome.fullCaptureMatchesOriginal &&
        hostCalls === 0 &&
        providerCalls === 0;
  results.push(outcome);
}
console.log(JSON.stringify({ mode, cases: results }, null, 2));
process.exitCode = results.every((result) => result.matchesExpectedDisposition) ? 0 : 1;
```

## Graph and journal identities

`evidence/capture-identities.json` records all 106 captures: exact raw-string SHA where available, complete JSON graph SHA, canonical replay SHA, legacy journal/heap SHA, promise-replay SHA, source/semantics identity, call/run IDs, argument digests, function/callback IDs and typed outcome SHA. TOJSON's original driver parses dump JSON first; its graph hashes are not mislabeled as original whitespace hashes. Other envelopes preserve exact raw strings.

Twelve Map outcome graphs check exact closure alias/capability/Map-key identity, shared Map values, object/Map/Set cycles and backlinks, sparse length 6, holes 0/2/5 and explicit undefined index 1. Later guest rows.metadata/raw/map assignments follow the retained host outcome; their absence from that earlier outcome is correct chronology, while the complete guest oracle checks them after assignment.

Twelve HOST callback-result/host-result typed graphs separately check metadata/raw, map/forEach shadows, named keys 01/-1/1.5/4294967295, indexed aliases/cycles and Map/Set links. All 24 raw checks are in `evidence/map-raw-graph-checks.json` and `evidence/host-raw-graph-checks.json`. No reference normalization.

Arity/HOST/ARG completed captures and specified TOJSON successful replays pass exact complete capture equality. Map typed replay, promise replay and initial inputs remain exactly equal, but complete Map dumps do not always remain equal.

## Preserved failures and open stronger requirement

- Initial source identity checker dereferenced the CLAUDE symlink instead of comparing link bytes. Corrected verification matches Git; original result and correction retained.
- Read-only metadata summaries initially assumed TOJSON argv rather than args and encountered an undefined listing field. No payload execution/source change resulted.
- TOJSON parent recorder first assumed callbacks was mandatory. Passive journals omit it. Original public driver/native assertions passed. Corrected recorder requires absent/empty for passive and exactly one for explicit, retaining initial receipts unchanged.
- First Markdown-generation command had a JavaScript template quoting syntax error before any output edit; subsequent generation uses literal placeholders. No runtime effect.
- Additional parent whole-dump equality fails after the first Map restore for both cases on both entries: **4 false comparisons**. The simple case changes heap only; collection also changes legacy hostCalls reference numbers (**2 false legacy-journal comparisons**). Second successive replay is stable. Complete native observations and canonical typed replay journals remain exact.

The exact same first/second heap representations are in approved prior Map manifest `f8a0135eed166bd67f932b7bdff967f84fdba5ea4aa8465c51af4a9f52d0ad4b`. `evidence/map-raw-stability-history.json` binds all four original artifacts/selectors. Released `packages/safejs/src/interp/host-call.ts` lines 143–167 validates legacy identity/lifecycle against typed replay then uses typed replay records. This explains the distinction; it is **not evidence of an explicitly accepted blanket whole-dump-stability restriction**.

**F4-MAP-DUMP-STABILITY remains an OPEN stronger serialization-contract/disposition question for root.** No new functional regression is established; inherited unproven notes are not promoted to confirmed bugs. Extra comparisons stay failed, not counted as passing original assertions. If whole-dump identity is an F4 acceptance criterion, this evidence does not grant unconditional approval. A separate author may investigate that contract; no production repair is made here.

Frozen handoff: `findings/map-dump-stability.json`, with exact benign sources, prior hashes, current selectors and unchanged native/canonical results. Failed comparison receipts: `evidence/map-full-dump-comparison-failure.json` and `evidence/map-legacy-journal-comparison-failure.json`. Captures are neither altered nor normalized.

## Publication and limits

Only this new plan/review is publishable: `docs/plans/safejs-final-common-boundary-composition-validation.md`, absent at both pinned base and pulled main. Runtime source/tests/prerequisites are not included in this documentation-only delta. The final manifest binds candidate bytes, absent preimage and all evidence; old capsules are untouched.

No fresh full unit, global lint/types/format or security certification. New Markdown gets focused formatting and strict diff validation. Prior 56 legacy type diagnostics and 1433 format-warning qualifications are historical, not rerun or declared clean. No new source/test file requires a code typecheck. No native prototype parity, repaired damaged old snapshots, universal hook detector, automatic migration/non-idempotent host reissue or exhaustive supported-program guarantee is claimed.

`evidence/runtime-summary.json` distinguishes **93 processes** from **124 case outcomes**. The bounded old-array-success/old-hook-object-RESET qualification and final published-all-stack HOLD remain explicit.
