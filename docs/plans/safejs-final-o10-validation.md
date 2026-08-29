# O10 / H8 portable final checkpoint-view validation

## Status and scope

**PREPARED FOR INDEPENDENT PEER REVIEW. Final published-stack H8 execution remains pending.**

Prepared August 29, 2026 by delegated validator Noether in the new isolated main checkout. A successful fast-forward pull pinned rehearsal HEAD `eca93c7aad06e35a29ba0343217594677b4d136d`. This document is an agent-executed Markdown procedure, not an executable QA runner. No production, README, home, other-clone, original-audit, branch, commit or push changes are proposed.

The bounded rehearsal passes six named profiles through distinct public **source** and **built** entrypoints. It does not certify every serializable graph, a future composite HEAD, PPR1, Nash's H5/H6 public-function proof, or Boyle's separately open completed-Map-alias defect. That defect is not scope-waived. Wait for the coordinator's final source/provenance freeze, including the Map source gate, before calling this final H8 evidence. Curie's O12 and Hilbert's H3 resolution are separate tasks.

Raw backend arguments and their binding references are shallow views. They can drift after a checkpoint is delivered. The bytes already persisted by public serialization are different evidence. **For these six cases**, fresh reconstruction preserves full final values, explicit identity/alias booleans, property order, traces, completed-effect suppression and pending-effect reissue. Do not infer an immutable raw-view contract from this result. In both graph completion profiles, later serialization of the retained view changes `heap` as well as `bindings`; that observation already existed in the frozen reference. No default live-pending `dump`, CLI AR interrupt, crash-durability or arbitrary external-service guarantee is claimed. The extra public failure capture uses the explicit supported `dump(execution, { onFailure: "checkpoint" })` path after an ordinary cancellation rejection, not a default pending dump.

README permission and scoped installed-skill sync permission are still unanswered. The accepted non-README contract-doc capture `2970e026...` is not changed or republished here. Root intake approval does not substitute for explicit user permission for README additions or home writes.

## Proposed publication and ownership

Only these two files are proposed; neither exists at rehearsal HEAD:

| Relative path                                             | Ownership                                       | Preimage | Scope                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `packages/safejs/src/checkpoint-views-validation.test.ts` | Existing Noether O10 test, copied byte-for-byte | ABSENT   | Two standalone positive memfs cases; no assertion, source, import or configuration edits |
| `docs/plans/safejs-final-o10-validation.md`               | Noether H8 preparation                          | ABSENT   | This portable procedure and qualified rehearsal record                                   |

The test SHA-256 remains `96e2894b1d62271c899d9b9b576ab42fe9bdc0671d72fbb4b23421fe446edeab` (5198 bytes). It embeds its small synthetic source and oracle; it imports only package source, Vitest and memfs. It never imports `out`, an old clone, a data index, a hidden test helper or an audit file. Its filesystem calls are memfs calls. It is positive coverage, not a new runtime regression repair or newly demonstrated RED test.

The data index, provenance copies, typecheck config, full child receipts and compiled-output inventory are **validation materials, not automatic publication inputs**. The old 35 KB report and 198 historical ignored artifacts are not an intake request. Root must explicitly approve any file intake after an independent peer review. Publisher must recheck the two absent preimages against the eventual target; an existing target is an identity conflict, not permission to overwrite.

## Material transport and H3 locators

The content-verified candidate root is:

`out/safejs-remediation/final-o10-qa/candidate-20260829-eca93c7a-o10-h8`

Its `manifest.json` inventories the exact proposed copies under `files/`, local evidence under `evidence/`, provenance under `provenance/`, and `data-index.json`. Transport that candidate directory together; do not depend on any old clone at execution time. Verify its supplied manifest hash out of band and every listed file hash before use. No embedded manifest self-hash is implied. The companion `handoff.json` gives ownership, base trees, absent preimages, commands and pending gates. Contents are sealed by SHA-256 and exclusive creation, not by a claim of filesystem write protection.

`data-index.json` SHA-256: `04c43a9f855b64dc9bf370b503bb95f2ef999d04637d4dbcab03792bfd9b24ae`.

The index embeds the **unchanged** three allowed captured sources at `/sources/map/source`, `/sources/graph/source`, and `/sources/scan/source`. Their SHA-256 identities are:

| Source | Bytes | SHA-256                                                            |
| ------ | ----: | ------------------------------------------------------------------ |
| map    |  2130 | `c0b72a8faf90b293535356f21543e3671483debd8d9d901397ad0e9ef0fb921c` |
| graph  |  3986 | `f8b3e2176440a0e60eaf851cde900f1066bf247510f858f172c161d9e4e42841` |
| scan   |  2379 | `08ef1329fc868ad12004905bfe5b62a1a5dce8f2d86e6d8a8e65ffb6dd31c976` |

All full values, calls and release schedules are in each profile's `/nativeExpected`; they are not truncated output summaries. Each of its eight `/restores/<index>` entries pins `expectedCalls`, `expectedReplayed`, release `schedule`, producer selector, signal mode and the historical receipt hash. `expectedValuePointer` selects the complete native value. Do not convert alias booleans or ordered JSON to unordered summaries.

| Profile             | Data selector | Completed releases at boundary | Pending gates        | Agent selection    |
| ------------------- | ------------- | -----------------------------: | -------------------- | ------------------ |
| map::two-workers    | `/profiles/0` |                              3 | `map:0:1`, `map:1:1` | `data.profiles[0]` |
| map::verify         | `/profiles/1` |                              9 | `verify`             | `data.profiles[1]` |
| graph::computed     | `/profiles/2` |                              2 | `computed`           | `data.profiles[2]` |
| graph::review       | `/profiles/3` |                              3 | `review`             | `data.profiles[3]` |
| scan::replacement   | `/profiles/4` |                              3 | `stream:2`           | `data.profiles[4]` |
| scan::unseeded-fold | `/profiles/5` |                              6 | `fold:1`             | `data.profiles[5]` |

For each selected profile, run native full and native cancellation first. Then run the current capture-and-eight-restore cell twice: `entry = "source"` and `entry = "built"`. These are **eight named forms**, not four snapshots multiplied by two signal settings:

| Restore identity                  | Producer output | JSON pointer to serialized text            | Signal            |
| --------------------------------- | --------------- | ------------------------------------------ | ----------------- |
| pending-before-complete-no-signal | complete        | `/observation/before/serialized`           | omitted           |
| retained-after-complete-no-signal | complete        | `/observation/after/retainedSerialized`    | omitted           |
| completed-no-signal               | complete        | `/completed`                               | omitted           |
| pending-before-cancel-no-signal   | cancel          | `/observation/before/serialized`           | omitted           |
| retained-after-cancel-no-signal   | cancel          | `/observation/after/retainedSerialized`    | omitted           |
| actual-after-cancel-no-signal     | cancel          | `/observation/after/lastBackendSerialized` | omitted           |
| actual-after-cancel-signal        | cancel          | `/observation/after/lastBackendSerialized` | fresh, un-aborted |
| public-failure-dump               | publicFailure   | `/failureDump`                             | omitted           |

A historical receipt's `/input` and `/stdout` are JSON **strings**: parse the selected string before applying its inner selector. New rehearsal receipts retain `/input` as an object and `/stdout` as a JSON string. For current full values select `/stdout`, parse it, then `/outcome/result`; for aliases and order compare the entire result and `JSON.stringify`, not a partial match. The current exact serialized snapshots are at the table's pointers inside parsed stdout. Record the SHA-256 of the exact string before parsing. Do not hash a re-indented graph and call it the original serialization.

Example H3 locator: `evidence/source-map-two-workers-complete.json#/stdout` (parse JSON), then `/observation/before/serialized`; fresh proof: `evidence/source-map-two-workers-resume-pending-before-complete-no-signal.json#/stdout` (parse JSON), then `/outcome`, `/calls`, `/replayed`, `/releases`. Replace profile slug and source/built prefix exactly as listed in the data index. All 144 fresh child receipts are preserved, including complete unabridged results, raw graph projections and checkpoint strings.

## Historical provenance and safety boundary

The frozen O10 manifest is `provenance/o10-reference-manifest.json`, SHA-256 `8f0a48b8300b2994d17cfae85acd8234c6498cac3cfa795df1eeb77fedd49601`, base `87f65dc26cdbdf28500e836204d2b205caaf8b80`. It declares two publishables and 198 ignored evidence artifacts. This preparation verified only the concrete evidence needed; it does **not** claim that all 198 were re-read.

Before reading the captured functional sources, the canonical metadata guard was verified: `provenance/audit-read-guard.json`, SHA-256 `4c6e8d142b8385d613187f969a21ae24529a682b1e7fd0d3420393e8c16133ca`. It contains 38 exact excluded paths and the entire `security/` deny prefix. The O10 guard metadata matches that set. **Zero original-audit payload reads; zero excluded-path reads, hashes or executions; zero recursive original-audit searches.** Original audit identities embedded in metadata are provenance strings only. Do not follow them during this procedure. Sources come solely from the previously approved captured `original-inputs.json`, SHA-256 `dd57076e291e3d0ccba6d55f38982a744d36892d35de353de6bf5d027a3fce6d`.

The historical driver falsely treated `hostCalls` as the whole journal and hit two watchdogs. Both failed receipts and `capture-driver-correction.json` are retained under provenance. The corrected selector uses `replay.calls` plus the completed-outcome count. Original uncorrected protocol SHA `dc90e9a09fac4d11985d93159d109ac8055d2f2e72b69443cdcceb8669868157` is **not** the executable protocol for this preparation. The corrected capture protocol SHA is `e546a21422ddad43643c40f0a3e5c7144849279059727bf46e6949ac7d5b6b44`; corrected public-failure protocol SHA is `b59ffe2280d70e301e97aea96577e40c3389c34c2ac2d73307af1f04692d1690`.

The two child blocks below preserve those programs byte-for-byte except a single portability substitution in each: `import('./packages/safejs/src/index.ts')` becomes `import(config.api)`. No workload transformation, version-marker rewriting, snapshot editing, oracle relaxation, synthetic EventEmitter signal or fake replay proof is introduced. The child is an owned finite validation process, never a guest-created process. Host capability exposure is only finite in-memory `exchange`; no guest filesystem/network/process/LLM or security probes are involved.

## Final execution prerequisites

1. Coordinator supplies the final published HEAD and receipts for the intended all-stack composition, including PPR1, H5 and the separate completed-Map source gate. Preserve the pinned historical record; append new execution evidence rather than changing this rehearsal into a final release claim.
2. Independent peer approves the portable materials and proposed test/doc copies. Root decides intake separately. Verify final target preimages and approved overlay hashes. No silent test discovery from an old clone or `out` directory.
3. Resolve dependencies without live skill sync or home writes. This preparation used a reflink copy of existing lock-matching `node_modules` into its new clone; no install lifecycle hooks ran. Final coordinator owns dependency setup and any necessary permissions.
4. Build the **actual** public built entrypoint from the same frozen source, in the final isolated checkout. Do not reuse old-clone dist or substitute a generated facade. Source uses `packages/safejs/src/index.ts` via tsx; built uses `packages/safejs/dist/index.js` with plain Node and **no tsx loader**. Record entrypoint hashes and compiled-output inventory. Root export `poe-code/safejs` and package export `@poe-code/safejs` target that built file at this rehearsal base.
5. Run configured composite build/types/full suite under the coordinator's final gate plan. This H8 preparation only ran finite selected package gates. Preserve historical legacy/unconfigured type diagnostics; selected success does not mean every TypeScript command passes.

For a source-only compile without production code generation or install scripts, the rehearsal ran `env -u TERM node node_modules/typescript/bin/tsc -p packages/<folder>/tsconfig.json` for this ordered package list:

`agent-defs, frontmatter, toolcraft-design, config-extends, config-mutations, auth-store, providers, toolcraft-schema, poe-code-config, process-runner, user-error, task-list, agent-harness-tools, agent-skill-config, agent-hook-config, poe-acp-client, agent-spawn, mcp-oauth, tiny-stdio-mcp-server, tiny-mcp-client, safejs`.

These are configured package compilations writing dist only, **not** a root release build, bundled release, template-copy step or installed sync. The first tiny-mcp-client attempt missed its dev declaration prerequisite and failed TS2307 for `tiny-stdio-mcp-server`; that receipt is retained. Compiling the missing package and retrying passed. Use the corrected order for a new run. Re-audit a changed package build graph rather than assuming this historical order remains sufficient.

## Agent-executed bounded procedure

Run the following cells in a persistent agent JavaScript session that supports top-level await/redeclaration, not a saved executable QA file. Choose a fresh owned evidence directory; writes use exclusive creation so an existing receipt stops execution. Review commands before running them. The parent reads only verified candidate materials and writes validation evidence; unit test bodies remain memfs-only. The environment intentionally omits TERM and redirects validation caches/home/temp under the isolated output directory. It grants no permission to touch the user's real home.

### Setup cell

Replace only the absolute final checkout and verified candidate paths. Verify final HEAD/provenance separately; do not replace source or expected data. Program extraction below checks the exact fenced bytes against the data index. Historical source/base hashes do not authorize executing an unverified future runtime.

```javascript
const fs = await import("node:fs/promises");
const cp = await import("node:child_process");
const path = await import("node:path");
const { createHash } = await import("node:crypto");
const assert = (await import("node:assert/strict")).default;
const root = "/ABSOLUTE/FINAL/PUBLISHED/CHECKOUT";
const material = "/ABSOLUTE/VERIFIED/O10/CANDIDATE";
const evidence = path.join(root, "out/safejs-remediation/final-o10-execution");
const node = cp.execFileSync("which", ["node"], { encoding: "utf8" }).trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = await fs.readFile(path.join(material, "data-index.json"), "utf8");
assert.equal(hash(text), "04c43a9f855b64dc9bf370b503bb95f2ef999d04637d4dbcab03792bfd9b24ae");
const data = JSON.parse(text);
const document = await fs.readFile(
  path.join(material, "files/docs/plans/safejs-final-o10-validation.md"),
  "utf8"
);
const programs = {};
for (const [name, description] of Object.entries(data.programs)) {
  const section = document.slice(document.indexOf(description.markdownHeading));
  const start = section.indexOf("\x60\x60\x60javascript\n") + 14;
  assert.ok(start >= 14);
  const finish = section.indexOf("\n\x60\x60\x60", start);
  programs[name] = section.slice(start, finish);
  assert.equal(hash(programs[name]), description.sha256);
}
assert.equal(new Set(data.guard.excludedExactPaths).size, 38);
assert.equal(data.guard.additionalDenyPrefix, "security/");
for (const source of Object.values(data.sources)) {
  assert.equal(hash(source.source), source.sha256);
  assert.equal(Buffer.byteLength(source.source), source.bytes);
}
await fs.mkdir(evidence, { recursive: true });
const env = {
  PATH: path.dirname(node) + ":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: path.join(evidence, "runtime/home"),
  TMPDIR: path.join(evidence, "runtime/tmp"),
  XDG_CACHE_HOME: path.join(evidence, "runtime/cache"),
  XDG_CONFIG_HOME: path.join(evidence, "runtime/config"),
  npm_config_cache: path.join(evidence, "runtime/npm-cache"),
  GIT_OPTIONAL_LOCKS: "0",
  POE_SNAPSHOT_MODE: "playback",
  POE_SNAPSHOT_MISS: "error"
};
for (const key of ["HOME", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "npm_config_cache"]) {
  await fs.mkdir(env[key], { recursive: true });
}
const pointer = (value, selector) =>
  selector
    .split("/")
    .slice(1)
    .reduce((entry, key) => entry[key], value);
const receipts = new Map();
async function child(profile, entry, action, variant) {
  const engine = entry === "native" ? "native" : "current";
  const selection = data.entrypoints[entry === "native" ? "source" : entry];
  const program = action === "publicFailure" ? "publicFailure" : "capture";
  const config = {
    id: profile.id,
    source: data.sources[profile.sourceKey].source,
    input: profile.input,
    boundary: profile.boundary,
    schedule: variant?.schedule ?? profile.schedule,
    engine,
    action: action === "publicFailure" ? "cancel" : action,
    api: selection.api
  };
  if (variant) {
    delete config.input;
    config.freshSignal = variant.freshSignal;
    const producer = receipts.get(entry + ":" + profile.id + ":" + variant.producer);
    config.snapshot = JSON.parse(pointer(producer, variant.pointer));
  }
  const argv = [
    "--max-old-space-size=256",
    ...selection.extraNodeArgs,
    "--input-type=module",
    "-e",
    programs[program]
  ];
  const startedAt = new Date().toISOString();
  const result = cp.spawnSync(node, argv, {
    cwd: root,
    env,
    input: JSON.stringify(config),
    encoding: "utf8",
    timeout: data.limits.parentTimeoutMs,
    maxBuffer: data.limits.maxBufferBytes
  });
  const label = entry + "-" + profile.slug + "-" + (variant?.id ?? action);
  const receipt = {
    command: [node, ...argv],
    input: config,
    startedAt,
    endedAt: new Date().toISOString(),
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout,
    stderr: result.stderr
  };
  await fs.writeFile(
    path.join(evidence, label + ".json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx" }
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sourceSha256, data.sources[profile.sourceKey].sha256);
  receipts.set(entry + ":" + profile.id + ":" + (variant?.id ?? action), output);
  return output;
}
function rawBinding(graph, name) {
  const rootNode = graph.nodes[graph.root.ref];
  const bindings = graph.nodes[rootNode.properties.bindings.ref];
  const seen = new Map();
  function visit(value) {
    if (value === null || typeof value !== "object") return value;
    if (value.kind === "undefined") return undefined;
    if (value.ref === undefined) return value;
    if (seen.has(value.ref)) return seen.get(value.ref);
    const node = graph.nodes[value.ref];
    const result = node.kind === "array" ? [] : {};
    seen.set(value.ref, result);
    for (const [key, item] of Object.entries(node.properties)) result[key] = visit(item);
    return result;
  }
  return visit(bindings.properties[name]);
}
```

### Native-first cell

Execute this cell for each of the six profile selectors, changing only the index. Finish all 12 native children before current runs. Cancellation channels compare name/message and preserve the full error; native DOMException also reports numeric code 20. Do not incorrectly reject that extra recorded field or erase it.

```javascript
const profile = data.profiles[0];
const nativeFull = await child(profile, "native", "full");
assert.deepEqual(nativeFull.outcome, { channel: "resolved", result: profile.nativeExpected.value });
assert.equal(
  JSON.stringify(nativeFull.outcome.result),
  JSON.stringify(profile.nativeExpected.value)
);
assert.deepEqual(nativeFull.calls, profile.nativeExpected.calls);
assert.deepEqual(nativeFull.releases, profile.nativeExpected.releases);
const nativeCancel = await child(profile, "native", "cancel");
assert.equal(nativeCancel.outcome.channel, "rejected");
assert.equal(nativeCancel.outcome.error.name, "AbortError");
assert.equal(nativeCancel.outcome.error.message, "ordinary-user-stop");
assert.deepEqual(nativeCancel.observation.extraCallsAfterStop, []);
```

### Current capture and fresh-restore cell

For each profile, select source and then built. Each cell owns three producer processes and eight new restore processes. The child receives no original entry inputs during restore. Each restore uses a JSON-parsed graph in a distinct OS process; no object references or heap state cross the process boundary. Both actual-after-cancel signal modes are explicit. Record every child PID and require uniqueness within the campaign; preserve statuses, stderr and full outputs even on failure.

```javascript
const profile = data.profiles[0];
const entry = "source";
const nativeCancel = receipts.get("native:" + profile.id + ":cancel");
assert.ok(nativeCancel);
for (const action of ["complete", "cancel", "publicFailure"]) {
  const output = await child(profile, entry, action);
  if (action === "complete") {
    assert.deepEqual(output.outcome, {
      channel: "resolved",
      result: profile.nativeExpected.value,
      ok: true
    });
    assert.equal(
      JSON.stringify(output.outcome.result),
      JSON.stringify(profile.nativeExpected.value)
    );
    assert.deepEqual(output.calls, profile.nativeExpected.calls);
    assert.deepEqual(output.releases, profile.nativeExpected.releases);
  } else {
    assert.equal(output.outcome.channel, "rejected");
    assert.equal(output.outcome.error.name, "AbortError");
    assert.equal(output.outcome.error.message, "ordinary-user-stop");
    assert.deepEqual(output.calls, nativeCancel.calls);
    assert.deepEqual(output.releases, nativeCancel.releases);
    assert.deepEqual(output.observation.extraCallsAfterStop, []);
  }
  assert.deepEqual(output.observation.before.pending, profile.boundary.pendingLabels);
  const before = JSON.parse(output.observation.before.serialized);
  const retained = JSON.parse(output.observation.after.retainedSerialized);
  for (const key of ["replay", "promiseReplay", "initialInputs"])
    assert.deepEqual(retained[key], before[key]);
  const expected = profile.rawViewExpectations.find(
    (item) => item.action === (action === "publicFailure" ? "cancel" : action)
  );
  const fields = [...new Set([...Object.keys(before), ...Object.keys(retained)])];
  const changed = fields.filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(retained[key])
  );
  assert.deepEqual(changed, expected.retainedChangedFields);
  assert.deepEqual(before.bindings[expected.bindingWitness.name], expected.bindingWitness.before);
  assert.deepEqual(
    retained.bindings[expected.bindingWitness.name],
    expected.bindingWitness.retainedAfter
  );
  assert.deepEqual(
    rawBinding(output.observation.before.raw, expected.bindingWitness.name),
    expected.bindingWitness.before
  );
  assert.deepEqual(
    rawBinding(output.observation.after.retainedRaw, expected.bindingWitness.name),
    expected.bindingWitness.retainedAfter
  );
}
for (const variant of profile.restores) {
  const output = await child(profile, entry, "resume", variant);
  assert.deepEqual(output.outcome, {
    channel: "resolved",
    result: profile.nativeExpected.value,
    ok: true
  });
  assert.equal(JSON.stringify(output.outcome.result), JSON.stringify(profile.nativeExpected.value));
  assert.deepEqual(output.calls, variant.expectedCalls);
  assert.deepEqual(output.releases, variant.schedule);
  assert.deepEqual(output.replayed, variant.expectedReplayed);
}
```

Do not rewrite the historical raw-drift assertion as a production immutability requirement. If a future deliberate detachment changes the raw observation while all durable guarantees still hold, stop and route the contract/control update for review. Do not silently weaken an assertion, edit the runtime, or label an unexpected output a pass. A new raw-view observation is distinct from a persisted-graph replay failure.

### Capture child protocol

Exact portable program SHA-256 `9207b1c256c4fcaa892c8debb6f08d71ccfc5038c6c490764dd10c771c9024be`. Leading/trailing newlines inside the fence are part of its identity. The preserved formatting is intentional.

<!-- prettier-ignore -->
```javascript

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
let text='';for await(const chunk of process.stdin)text+=chunk;const config=JSON.parse(text);
const watchdog=setTimeout(()=>{console.error(JSON.stringify({watchdog:'bounded validation watchdog',calls,releases,outcome,pending:[...gates.keys()],writes:writes.map(entry=>({calls:entry.calls,releases:entry.releases,hostCalls:JSON.parse(entry.serialized).hostCalls,rawHostCalls:entry.snapshot.hostCalls?.map(call=>({lifecycle:call.lifecycle,hasOutcome:call.outcome!==undefined}))}))}));process.exit(70)},6000);
const started=performance.now();const calls=[],releases=[],replayed=[],writes=[];const gates=new Map();let clock=0;let stopped=false;let outcome;let notifications=[];
const notify=()=>{const current=notifications;notifications=[];for(const resolve of current)resolve()};
const waitFor=async(predicate)=>{while(!predicate()){if(outcome)throw Error('execution settled before boundary '+JSON.stringify(outcome));await new Promise(resolve=>notifications.push(resolve));}};
const clone=value=>JSON.parse(JSON.stringify(value));
const receipt=(label,payload)=>({label,status:'fulfilled',size:payload.size,receipt:label+':ok'});
const controller=new AbortController();
function exchange(label,payload){clock+=2;calls.push({label,payload:clone(payload)});let resolveGate;const raw=new Promise(resolve=>{resolveGate=resolve});gates.set(label,{resolve:()=>resolveGate(receipt(label,payload)),payload});notify();if(config.engine==='native'&&config.action==='cancel'){return new Promise((resolve,reject)=>{const abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});raw.then(value=>{controller.signal.removeEventListener('abort',abort);resolve(value)},reject)});}return raw;}
const release=label=>{const gate=gates.get(label);if(!gate)throw Error('missing gate '+label);gates.delete(label);releases.push(label);gate.resolve();};
const rawGraph=value=>{const objects=new Map();const nodes=[];function visit(item){if(item===undefined)return {kind:'undefined'};if(typeof item==='number'&&!Number.isFinite(item))return {kind:'number',value:String(item)};if(item===null||['boolean','number','string'].includes(typeof item))return item;if(typeof item==='symbol')return {kind:'symbol',value:item.description};if(objects.has(item))return {ref:objects.get(item)};const id=nodes.length;objects.set(item,id);const node={id,kind:typeof item==='function'?'function':Array.isArray(item)?'array':item instanceof Map?'map':item instanceof Set?'set':'object',properties:{}};nodes.push(node);if(item instanceof Map)node.entries=[...item].map(([key,entry])=>[visit(key),visit(entry)]);if(item instanceof Set)node.entries=[...item].map(visit);for(const key of Object.keys(item)){const descriptor=Object.getOwnPropertyDescriptor(item,key);node.properties[key]=descriptor&&'value'in descriptor?visit(descriptor.value):{kind:'accessor-not-invoked'};}return {ref:id};}return {root:visit(value),nodes};};
let api;let execution;let retained;const originalNow=Date.now;
try{
 if(config.engine==='native'){globalThis.exchange=exchange;const module=await import('data:text/javascript;base64,'+Buffer.from(config.source).toString('base64'));execution=module.default(clone(config.input));}
 else{api=await import(config.api);Date.now=()=>clock;const operation=api.declareHostOperation(exchange,'re-issue',{onReplay:(args,recorded)=>{replayed.push({label:args[0],payload:clone(args[1]),outcome:clone(recorded)});notify();}});execution=api.run(config.source,{bindings:{exchange:operation},...(config.snapshot?{snapshot:api.restore(config.snapshot,{source:config.source})}:{entryPointArgs:[clone(config.input)]}),...(config.action==='cancel'||config.freshSignal?{signal:controller.signal}:{}),randomSeed:123,budget:new api.Budget({maxSteps:150000,maxCallDepth:96,stringLength:32768,arrayLength:1024,dataSize:3000000}),snapshotIntervalMs:1,...(!config.snapshot?{snapshotBackend:{async read(){return undefined},async remove(){},async write(snapshot){const graph=rawGraph(snapshot);const serialized=await api.dump({snapshot});writes.push({snapshot,graph,serialized,calls:clone(calls),releases:[...releases]});notify();}}}:{})});}
 execution.then(result=>{outcome={channel:'resolved',result:config.engine==='native'?result:result.returnValue,...(config.engine==='native'?{}:{ok:result.ok})};notify()},error=>{outcome={channel:'rejected',error:{name:error.name,message:error.message,code:error.code,budget:error.budget}};notify()});
 const schedule=config.schedule;
 if(config.action==='full'||config.action==='resume'){for(const label of schedule){await waitFor(()=>gates.has(label));release(label);}await waitFor(()=>outcome!==undefined);}
 else{for(const label of schedule.slice(0,config.boundary.releaseCount)){await waitFor(()=>gates.has(label));release(label);}await waitFor(()=>config.boundary.pendingLabels.every(label=>gates.has(label)));
  if(config.engine!=='native'){await waitFor(()=>writes.some(entry=>{const journal=JSON.parse(entry.serialized).replay?.calls??[];return journal.length===calls.length&&journal.filter(call=>call.outcome!==undefined).length===config.boundary.releaseCount;}));retained=[...writes].reverse().find(entry=>{const journal=JSON.parse(entry.serialized).replay?.calls??[];return journal.length===calls.length&&journal.filter(call=>call.outcome!==undefined).length===config.boundary.releaseCount;});}
  const before={calls:clone(calls),releases:[...releases],pending:[...gates.keys()],...(retained?{serialized:retained.serialized,raw:rawGraph(retained.snapshot)}:{})};
  if(config.action==='cancel'){stopped=true;controller.abort(new DOMException('ordinary-user-stop','AbortError'));await waitFor(()=>outcome!==undefined);for(const label of [...gates.keys()])release(label);await new Promise(resolve=>setImmediate(resolve));}
  else{for(const label of schedule.slice(config.boundary.releaseCount)){await waitFor(()=>gates.has(label));release(label);}await waitFor(()=>outcome!==undefined);}
  config.observation={before,after:{calls:clone(calls),releases:[...releases],...(retained?{retainedSerialized:await api.dump({snapshot:retained.snapshot}),retainedRaw:rawGraph(retained.snapshot),lastBackendSerialized:writes.at(-1)?.serialized,lastBackendRaw:writes.at(-1)?.graph}: {})},extraCallsAfterStop:stopped?calls.slice(before.calls.length):undefined};
 }
 if(outcome.channel==='resolved'&&config.engine!=='native')config.completed=await api.dump(await execution);
 console.log(JSON.stringify({engine:config.engine,action:config.action,id:config.id,pid:process.pid,sourceSha256:createHash('sha256').update(config.source).digest('hex'),outcome,calls,releases,replayed,observation:config.observation,completed:config.completed,writes:writes.map(({graph,serialized,calls,releases})=>({graph,serialized,calls,releases})),durationMs:performance.now()-started}));
}finally{Date.now=originalNow;clearTimeout(watchdog)}

```

### Public-failure child protocol

Exact portable program SHA-256 `e0f809280d401a9a110eeff6004b58785d982213a8fbfc8b00c824ea2833e0e7`.

<!-- prettier-ignore -->
```javascript

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
let text='';for await(const chunk of process.stdin)text+=chunk;const config=JSON.parse(text);
const watchdog=setTimeout(()=>{console.error(JSON.stringify({watchdog:'bounded validation watchdog',calls,releases,outcome,pending:[...gates.keys()],writes:writes.map(entry=>({calls:entry.calls,releases:entry.releases,hostCalls:JSON.parse(entry.serialized).hostCalls,rawHostCalls:entry.snapshot.hostCalls?.map(call=>({lifecycle:call.lifecycle,hasOutcome:call.outcome!==undefined}))}))}));process.exit(70)},6000);
const started=performance.now();const calls=[],releases=[],replayed=[],writes=[];const gates=new Map();let clock=0;let stopped=false;let outcome;let notifications=[];
const notify=()=>{const current=notifications;notifications=[];for(const resolve of current)resolve()};
const waitFor=async(predicate)=>{while(!predicate()){if(outcome)throw Error('execution settled before boundary '+JSON.stringify(outcome));await new Promise(resolve=>notifications.push(resolve));}};
const clone=value=>JSON.parse(JSON.stringify(value));
const receipt=(label,payload)=>({label,status:'fulfilled',size:payload.size,receipt:label+':ok'});
const controller=new AbortController();
function exchange(label,payload){clock+=2;calls.push({label,payload:clone(payload)});let resolveGate;const raw=new Promise(resolve=>{resolveGate=resolve});gates.set(label,{resolve:()=>resolveGate(receipt(label,payload)),payload});notify();if(config.engine==='native'&&config.action==='cancel'){return new Promise((resolve,reject)=>{const abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});raw.then(value=>{controller.signal.removeEventListener('abort',abort);resolve(value)},reject)});}return raw;}
const release=label=>{const gate=gates.get(label);if(!gate)throw Error('missing gate '+label);gates.delete(label);releases.push(label);gate.resolve();};
const rawGraph=value=>{const objects=new Map();const nodes=[];function visit(item){if(item===undefined)return {kind:'undefined'};if(typeof item==='number'&&!Number.isFinite(item))return {kind:'number',value:String(item)};if(item===null||['boolean','number','string'].includes(typeof item))return item;if(typeof item==='symbol')return {kind:'symbol',value:item.description};if(objects.has(item))return {ref:objects.get(item)};const id=nodes.length;objects.set(item,id);const node={id,kind:typeof item==='function'?'function':Array.isArray(item)?'array':item instanceof Map?'map':item instanceof Set?'set':'object',properties:{}};nodes.push(node);if(item instanceof Map)node.entries=[...item].map(([key,entry])=>[visit(key),visit(entry)]);if(item instanceof Set)node.entries=[...item].map(visit);for(const key of Object.keys(item)){const descriptor=Object.getOwnPropertyDescriptor(item,key);node.properties[key]=descriptor&&'value'in descriptor?visit(descriptor.value):{kind:'accessor-not-invoked'};}return {ref:id};}return {root:visit(value),nodes};};
let api;let execution;let retained;const originalNow=Date.now;
try{
 if(config.engine==='native'){globalThis.exchange=exchange;const module=await import('data:text/javascript;base64,'+Buffer.from(config.source).toString('base64'));execution=module.default(clone(config.input));}
 else{api=await import(config.api);Date.now=()=>clock;const operation=api.declareHostOperation(exchange,'re-issue',{onReplay:(args,recorded)=>{replayed.push({label:args[0],payload:clone(args[1]),outcome:clone(recorded)});notify();}});execution=api.run(config.source,{bindings:{exchange:operation},...(config.snapshot?{snapshot:api.restore(config.snapshot,{source:config.source})}:{entryPointArgs:[clone(config.input)]}),...(config.action==='cancel'||config.freshSignal?{signal:controller.signal}:{}),randomSeed:123,budget:new api.Budget({maxSteps:150000,maxCallDepth:96,stringLength:32768,arrayLength:1024,dataSize:3000000}),snapshotIntervalMs:1,...(!config.snapshot?{snapshotBackend:{async read(){return undefined},async remove(){},async write(snapshot){const graph=rawGraph(snapshot);const serialized=await api.dump({snapshot});writes.push({snapshot,graph,serialized,calls:clone(calls),releases:[...releases]});notify();}}}:{})});}
 execution.then(result=>{outcome={channel:'resolved',result:config.engine==='native'?result:result.returnValue,...(config.engine==='native'?{}:{ok:result.ok})};notify()},error=>{outcome={channel:'rejected',error:{name:error.name,message:error.message,code:error.code,budget:error.budget}};notify()});
 const schedule=config.schedule;
 if(config.action==='full'||config.action==='resume'){for(const label of schedule){await waitFor(()=>gates.has(label));release(label);}await waitFor(()=>outcome!==undefined);}
 else{for(const label of schedule.slice(0,config.boundary.releaseCount)){await waitFor(()=>gates.has(label));release(label);}await waitFor(()=>config.boundary.pendingLabels.every(label=>gates.has(label)));
  if(config.engine!=='native'){await waitFor(()=>writes.some(entry=>{const journal=JSON.parse(entry.serialized).replay?.calls??[];return journal.length===calls.length&&journal.filter(call=>call.outcome!==undefined).length===config.boundary.releaseCount;}));retained=[...writes].reverse().find(entry=>{const journal=JSON.parse(entry.serialized).replay?.calls??[];return journal.length===calls.length&&journal.filter(call=>call.outcome!==undefined).length===config.boundary.releaseCount;});}
  const before={calls:clone(calls),releases:[...releases],pending:[...gates.keys()],...(retained?{serialized:retained.serialized,raw:rawGraph(retained.snapshot)}:{})};
  if(config.action==='cancel'){stopped=true;controller.abort(new DOMException('ordinary-user-stop','AbortError'));await waitFor(()=>outcome!==undefined);for(const label of [...gates.keys()])release(label);await new Promise(resolve=>setImmediate(resolve));}
  else{for(const label of schedule.slice(config.boundary.releaseCount)){await waitFor(()=>gates.has(label));release(label);}await waitFor(()=>outcome!==undefined);}
  config.observation={before,after:{calls:clone(calls),releases:[...releases],...(retained?{retainedSerialized:await api.dump({snapshot:retained.snapshot}),retainedRaw:rawGraph(retained.snapshot),lastBackendSerialized:writes.at(-1)?.serialized,lastBackendRaw:writes.at(-1)?.graph}: {})},extraCallsAfterStop:stopped?calls.slice(before.calls.length):undefined};
 }
 if(outcome.channel==='resolved'&&config.engine!=='native')config.completed=await api.dump(await execution);
 if(outcome.channel==='rejected'&&config.engine!=='native')config.failureDump=await api.dump(execution,{onFailure:'checkpoint'});
 console.log(JSON.stringify({engine:config.engine,action:config.action,id:config.id,pid:process.pid,sourceSha256:createHash('sha256').update(config.source).digest('hex'),outcome,calls,releases,replayed,observation:config.observation,completed:config.completed,failureDump:config.failureDump,writes:writes.map(({graph,serialized,calls,releases})=>({graph,serialized,calls,releases})),durationMs:performance.now()-started}));
}finally{Date.now=originalNow;clearTimeout(watchdog)}

```

## Test and static commands

The proper test has no transport-material dependency. From the validated checkout, run:

```sh
env -u TERM node node_modules/vitest/vitest.mjs run packages/safejs/src/checkpoint-views-validation.test.ts
env -u TERM node node_modules/eslint/bin/eslint.js packages/safejs/src/checkpoint-views-validation.test.ts
env -u TERM node node_modules/prettier/bin/prettier.cjs --check packages/safejs/src/checkpoint-views-validation.test.ts docs/plans/safejs-final-o10-validation.md
env -u TERM node node_modules/typescript/bin/tsc -p packages/safejs/tsconfig.json --noEmit
```

The candidate contains the supplemental new-test config as `evidence/new-test-tsconfig.json`; its recorded command uses its working location `out/safejs-remediation/final-o10-qa/new-test-tsconfig.json`. Its only extra include is the new test, it extends the root tsconfig, and it sets noEmit. At a different transport location, copy the config to that same owned working location, or adjust only its relative paths and record the changed config hash. Do not claim the source-only configured package check includes the new test: that package config excludes `*.test.ts`.

Run strict whitespace against every proposed file, including untracked new files:

```sh
git diff --check
git diff --no-index --check /dev/null packages/safejs/src/checkpoint-views-validation.test.ts
git diff --no-index --check /dev/null docs/plans/safejs-final-o10-validation.md
```

No trailing hardbreak spaces are waived merely because Prettier accepts them. For no-index checks distinguish a reported whitespace error from an ordinary diff exit; retain actual statuses and output. Do not stage files just to obtain a diff.

## Actual preparation results

| Gate                                                                        | Result at rehearsal HEAD                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Original native full + cancellation                                         | 12 fresh children, all exit 0; six full values/order/call/release matches                                  |
| Source capture producers                                                    | 18 fresh children, all exit 0                                                                              |
| Source fresh serialized restores                                            | 48 / 48 pass, eight per profile                                                                            |
| Built capture producers                                                     | 18 fresh children, all exit 0, plain Node imports actual dist                                              |
| Built fresh serialized restores                                             | 48 / 48 pass, eight per profile                                                                            |
| Raw identity witnesses                                                      | 36 / 36 match historical before/retained-after expectations                                                |
| Markdown procedure smoke                                                    | map::two-workers: 2 native + 6 producers + 16 fresh restores pass, additional to the six-profile rehearsal |
| Original standalone memfs test                                              | 2 / 2 pass unchanged                                                                                       |
| Selected adjacent tests, including that test                                | 146 / 146 pass across eight files; zero skipped/filtered                                                   |
| Configured package compile closure                                          | 21 distinct packages compile successfully after one missing-prerequisite retry                             |
| Configured SafeJS source types                                              | Exit 0                                                                                                     |
| Supplemental exact new-test types                                           | Exit 0                                                                                                     |
| New-test ESLint                                                             | Exit 0                                                                                                     |
| Proposed test/doc Prettier and strict whitespace                            | Final receipts are indexed in the sealed manifest                                                          |
| Full repository build/full suite, release packaging, screenshots/CLI SIGINT | Not run; outside this bounded H8 preparation                                                               |

The eight selected files are the new checkpoint-view test, `dump.test.ts`, `restore.test.ts`, `run.completed-replay.test.ts`, `run.failure-replay.test.ts`, `snapshot/replay-inputs.test.ts`, `snapshot/replay-data.test.ts`, and `snapshot/restore.test.ts`, all under `packages/safejs/src`. No full-suite claim is made. The two initial passing tests are included in the later 146; do not add them and claim 148 distinct cases.

The preparation preserved two parent-side assertion mistakes in `evidence/parent-corrections.json`: (1) a hand-built normalized native error expectation accidentally demanded absence of DOMException.code; (2) a hand-built retained-view comparison accidentally demanded stable heap text for graph completion, contrary to the historical `[bindings, heap]` observation. Child processes succeeded in both cases. Existing receipts were rechecked, not overwritten or double-counted, after correcting the parent expectations to the pre-existing frozen controls. No source, oracle, child protocol, test assertion or runtime was repaired. The two historical watchdog failures remain separate provenance. The initial missing build prerequisite remains a separate command failure; later success does not erase it.

Final execution must reproduce the six profile values, ordered traces/keys, alias predicates, 12 native controls, 36 source/built captures and 96 fresh restores, then attach final HEAD/build/provenance and the coordinator's required whole-stack gates. If any gate is absent or fails, report the exact profile, phase, pointer and receipt and stop for the owning author. **This preparation is not final product approval, root publication approval, an O10 blanket closure, or closure of Boyle's Map issue.**
