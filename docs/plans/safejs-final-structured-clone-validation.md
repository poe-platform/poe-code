# EXEC-CLONE-1 structured clone validation

## Assignment and execution boundary

August 29, 2026. Direct independent delegated worker. Resolve the missing bounded
native/current/public-completed-replay recipe for `objects:clone-structured`,
profile `structured`, without inventing historical command arguments.

Create the requested isolated main clone and pull before edits. Do not change
production, README, home configuration, existing assertions, or any other clone.
Do not commit, push, create feature branches, read original audit payloads, run old
QA/harness scripts, or investigate excluded/security payloads. No guest I/O, real
LLMs, network calls, or filesystem capabilities are permitted in this case.

The H3 follow-up manifest is
`d513b006769864efbabf45adcbdb4a21237a9d4c31e09e1295c5022e16b6d848`.
Use `oracle-index.json#/executorAssignments/0` and its hash-bound source, exact
profile, full native expectation, and reference protocol. Install the exact 38
exclusions plus all `security/` before reading any captured source payload.

## Agent-executed procedure

1. Verify manifest/index/envelope hashes and source provenance before selecting
   any input. Read only the explicitly allowlisted nonexcluded captured copies.
2. Inspect the unchanged source and profile for capability requirements and finite
   bounds before native execution. Preserve every returned field and typed graph,
   including sparse presence, alias/cycle identity, and named metadata.
3. Record a new exact inline native command, not reconstructed historical argv.
   Execute current public source and built entrypoints, capture genuine completed
   dumps, and replay from fresh parsed/restored captures.
4. Keep all failures and full outputs. If identity or another real observation
   differs, stop approval and hand off to the responsible owner without edits or
   oracle normalization. Do not duplicate Boyle or PATCH4 work.
5. Freeze this portable Markdown recipe, selected data, exact commands and
   evidence. Root/peer recipe review and the final published composite execution
   gate remain separate from this bounded task.

## Provenance qualification

H3 reports 443 initial guarded reads, with 73 surviving safe envelopes and 369
durable recovery reads. Initial per-read chronology was lost during a kernel
reset. This task preserves that qualification; it does not certify the missing
initial chronology or replace it with invented receipts. No original audit
payload reread is needed or authorized here.

## Status

**READY FOR ROOT/PEER RECIPE REVIEW.** The bounded new recipe passes on isolated
main `eca93c7aad06e35a29ba0343217594677b4d136d`, with no overlays. This is not
approval of the final composite, release closure, or the pending Map-value alias
repair. The original source, profile and oracle remain unchanged.

## Exact input and configuration identities

Run from the isolated checkout root. `EXEC_CLONE_CAPTURE` may point to the frozen
capture directory in another location; it is host-side input storage, never a
guest capability. The default is `out/safejs-remediation/exec-clone-1`.

- Source: 1,493 bytes;
  `5f13ec38ccdd4f3a0a36e03032bbee39c1c08fbc8370a3a9a04b4816c440fc01`.
  Exact H3 `F0003#/text`, original logical `objects/lodash-clone.ajs`.
- Selected profile: 704 bytes;
  `c850afce4da39f597c4e2b83851bfd6235013123295897ecaa0da6992fedc737`.
  `caseName: "structured"`, filename `lodash-clone.ajs`, numeric random seed 827.
- Full expected return: 350 bytes;
  `cac8b01df7032cc59a04377b978d7e9e83e18a6c12c2932bbcdf112e1ba37bd2`.
  H3 `F0004#/text` decoded as JSON, `/results/1/expected`, equal to the complete
  `/results/1/reference/expected` and parsed reference stdout.
- The original native protocol is H3 `F0395#/text`, decoded as JSON, then
  `/referenceProtocol`: a fresh Node child and AsyncFunction with `caseName`.
- Exact limits from the captured profile: 1,500,000 steps, depth 128, string length
  262,144, array length 4,096, data size 1,048,576, fresh deadline 4,000 ms, child
  timeout 12,000 ms. The host child also retains the captured reproduction's
  256 MiB old-space ceiling and 1 MiB output limit.

This is a newly authored recipe. The captured old report is read for limits and
API/configuration provenance only; its harness command is not executed. The
historical string-random-seed infrastructure failure remains in the captured case
history and is not represented as a functional run.

The source has only fixed data construction and supported pure builtins. Its
alternate `cloneGraph` helper remains unchanged but is not called by the selected
structured profile. No imports, host functions, guest filesystem, network, or LLM
are supplied. No additional synthetic sparse or Map case substitutes for it.

## Preparation commands

Use the existing dependency lockfile without modifying it. Lifecycle scripts are
disabled during installation to prevent Git-hook or home-skill side effects. The
targeted forced build prepares the real public built entrypoint and dependencies;
it is not the whole-repository build or final composite gate.

```sh
env -u TERM SKIP_SYNC_SKILLS=1 HUSKY=0 \
  npm_config_cache="$PWD/out/safejs-remediation/exec-clone-1-cache/npm" \
  XDG_CACHE_HOME="$PWD/out/safejs-remediation/exec-clone-1-cache/xdg" \
  npm ci --ignore-scripts --no-audit --no-fund
env -u TERM SKIP_SYNC_SKILLS=1 HUSKY=0 TURBO_TELEMETRY_DISABLED=1 \
  npm_config_cache="$PWD/out/safejs-remediation/exec-clone-1-cache/npm" \
  XDG_CACHE_HOME="$PWD/out/safejs-remediation/exec-clone-1-cache/xdg" \
  node_modules/.bin/turbo run build --filter=@poe-code/safejs... --force
```

## New bounded native/current/completed-replay command

Execute this inline command as an agent procedure, not a saved standalone QA
runner. It reads only the three verified selected inputs. It writes no files;
capture its complete stdout/stderr/status externally as evidence. Each execution
and each restoration gets a fresh Node process. Native runs before source/built
executions. Both completed producers are replayed once through each public
entrypoint, giving one native anchor, two current runs and four fresh replays.

The typed graph retains every value, key order, array length and present slot,
named property, alias, and cycle. It does not clone or JSON-normalize the observed
runtime graph before comparison. Object-prototype and null-prototype data records
are the same logical record kind under this case's declared JSON-safe-summary
protocol; no reference identity is erased. Unsupported types stop the recipe.

```sh
env -u TERM SKIP_SYNC_SKILLS=1 HUSKY=0 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error \
  npm_config_cache="$PWD/out/safejs-remediation/exec-clone-1-cache/npm" \
  XDG_CACHE_HOME="$PWD/out/safejs-remediation/exec-clone-1-cache/xdg" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const capture = process.env.EXEC_CLONE_CAPTURE ?? "out/safejs-remediation/exec-clone-1";
const identities = {
  "source.ajs": "5f13ec38ccdd4f3a0a36e03032bbee39c1c08fbc8370a3a9a04b4816c440fc01",
  "profile.json": "c850afce4da39f597c4e2b83851bfd6235013123295897ecaa0da6992fedc737",
  "expected.json": "cac8b01df7032cc59a04377b978d7e9e83e18a6c12c2932bbcdf112e1ba37bd2"
};
const loaded = {};
for (const [name, expectedHash] of Object.entries(identities)) {
  const bytes = readFileSync(`${capture}/inputs/${name}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  loaded[name] = bytes.toString("utf8");
}
const input = {
  source: loaded["source.ajs"],
  profile: JSON.parse(loaded["profile.json"]),
  expected: JSON.parse(loaded["expected.json"])
};
assert.equal(input.profile.caseId, "objects:clone-structured");
assert.equal(input.profile.caseName, "structured");

function typedGraph(root) {
  const references = new Map();
  const nodes = [];
  function encode(value) {
    if (value === null) return { kind: "null" };
    if (value === undefined) return { kind: "undefined" };
    if (typeof value === "boolean" || typeof value === "string") {
      return { kind: typeof value, value };
    }
    if (typeof value === "number") {
      return { kind: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    }
    assert.equal(typeof value, "object", "Unsupported observation type");
    if (references.has(value)) return { kind: "ref", id: references.get(value) };
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    assert.ok(array || prototype === null || prototype === Object.prototype);
    assert.equal(Object.getOwnPropertySymbols(value).length, 0);
    const id = nodes.length;
    references.set(value, id);
    nodes.push(null);
    const entries = Object.keys(value).map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assert.ok(descriptor && Object.hasOwn(descriptor, "value"));
      return { key, value: encode(descriptor.value) };
    });
    nodes[id] = array
      ? { kind: "array", length: value.length, entries }
      : { kind: "record", entries };
    return { kind: "ref", id };
  }
  const rootReference = encode(root);
  return { root: rootReference, nodes };
}

function selectedBindings(result) {
  const selected = {};
  for (const name of ["leaf", "sparse", "input", "copy"]) {
    const descriptor = Object.getOwnPropertyDescriptor(result.snapshot.bindings, name);
    assert.ok(descriptor && Object.hasOwn(descriptor, "value"), `Missing ${name}`);
    selected[name] = descriptor.value;
  }
  const { leaf, sparse, input: original, copy } = selected;
  assert.equal(leaf, original.first);
  assert.equal(sparse, original.sparse);
  assert.equal(original.first, original.second);
  assert.equal(leaf.parent, original);
  assert.equal(original.self, original);
  assert.notEqual(copy, original);
  assert.notEqual(copy.first, leaf);
  assert.equal(copy.first, copy.second);
  assert.equal(copy.first.parent, copy);
  assert.equal(copy.self, copy);
  assert.equal(copy.sparse[1], copy.first);
  assert.equal(leaf.count, 4);
  assert.equal(copy.first.count, 9);
  assert.notEqual(copy.first.nested, leaf.nested);
  for (const item of [leaf, copy.first]) {
    assert.equal(Object.hasOwn(item, "missing"), true);
    assert.equal(item.missing, undefined);
    assert.equal(item.nested.active, true);
  }
  for (const item of [sparse, copy.sparse]) {
    assert.equal(item.length, 5);
    assert.deepEqual(Object.keys(item), ["1", "3"]);
    assert.deepEqual(Array.from({ length: 5 }, (_, index) => Object.hasOwn(item, index)),
      [false, true, false, true, false]);
    assert.equal(item[3], undefined);
  }
  return selected;
}

const records = [];
const sourceEntry = pathToFileURL(resolve("packages/safejs/src/index.ts")).href;
const builtEntry = pathToFileURL(resolve("packages/safejs/dist/index.js")).href;
const common = `import assert from "node:assert/strict";
const input = ${JSON.stringify(input)};
const typedGraph = ${typedGraph.toString()};
const selectedBindings = ${selectedBindings.toString()};`;

function child(label, engine, snapshotText) {
  const entry = engine === "source" ? sourceEntry : builtEntry;
  const body = engine === "native" ? `
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const value = await new AsyncFunction("caseName", input.source)(input.profile.caseName);
const actual = { kind: "return", value };
const returnGraph = typedGraph(actual);
assert.deepEqual(returnGraph, typedGraph(input.expected));
console.log(JSON.stringify({ label: ${JSON.stringify(label)}, actual, returnGraph }));
` : `
const api = await import(${JSON.stringify(entry)});
const bounds = input.profile.bounds;
const budget = new api.Budget({
  maxSteps: bounds.maxSteps,
  maxCallDepth: bounds.maxCallDepth,
  stringLength: bounds.stringLength,
  arrayLength: bounds.arrayLength,
  dataSize: bounds.dataSize,
  deadline: Date.now() + bounds.deadlineMs
});
const snapshotText = ${JSON.stringify(snapshotText ?? null)};
const options = {
  filename: input.profile.filename,
  bindings: { caseName: input.profile.caseName },
  randomSeed: input.profile.randomSeed,
  budget
};
if (snapshotText !== null) {
  options.snapshot = api.restore(JSON.parse(snapshotText), { source: input.source });
}
const result = await api.run(input.source, options);
assert.equal(result.ok, true);
const actual = { kind: "return", value: result.returnValue };
const returnGraph = typedGraph(actual);
assert.deepEqual(returnGraph, typedGraph(input.expected));
const bindingsGraph = typedGraph(selectedBindings(result));
const completedSnapshot = await api.dump(result);
assert.deepEqual(typedGraph(selectedBindings(result)), bindingsGraph);
const envelope = JSON.parse(completedSnapshot);
assert.ok(envelope.bindings && envelope.initialInputs && envelope.replay);
console.log(JSON.stringify({
  label: ${JSON.stringify(label)}, entrypoint: ${JSON.stringify(entry)},
  actual, returnGraph, bindingsGraph, steps: budget.stepsUsed,
  restoredFromFreshParsedCapture: snapshotText !== null,
  completedSnapshot
}));
`;
  const code = common + body;
  const argv = ["--max-old-space-size=256"];
  if (engine === "source") argv.push("--import", "tsx");
  argv.push("--input-type=module", "--eval", code);
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, argv, {
    encoding: "utf8", timeout: input.profile.bounds.hostTimeoutMs, maxBuffer: 1048576
  });
  const receipt = {
    label, engine, argv: [process.execPath, ...argv], startedAt,
    endedAt: new Date().toISOString(), exitCode: result.status,
    signal: result.signal, error: result.error?.message,
    stdout: result.stdout, stderr: result.stderr
  };
  records.push(receipt);
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  assert.equal(result.signal, null);
  receipt.output = JSON.parse(result.stdout);
  return receipt.output;
}

try {
  const native = child("native-anchor", "native");
  const source = child("source-completed", "source");
  const built = child("built-completed", "built");
  assert.deepEqual(source.returnGraph, native.returnGraph);
  assert.deepEqual(built.returnGraph, native.returnGraph);
  assert.deepEqual(built.bindingsGraph, source.bindingsGraph);
  for (const [producer, capture] of [["source", source], ["built", built]]) {
    for (const engine of ["source", "built"]) {
      const replay = child(`${producer}-capture-to-${engine}-fresh-replay`, engine,
        capture.completedSnapshot);
      assert.deepEqual(replay.returnGraph, native.returnGraph);
      assert.deepEqual(replay.bindingsGraph, source.bindingsGraph);
    }
  }
  console.log(JSON.stringify({
    status: "PASS_BOUNDED_EXEC_CLONE_1_NOT_FINAL_COMPOSITE",
    unchangedSourceSha256: identities["source.ajs"], profile: input.profile,
    fullExpected: input.expected, nativeAnchors: 1, currentRuns: 2,
    freshCompletedReplays: 4, records
  }));
} catch (error) {
  console.log(JSON.stringify({
    status: "FAIL_ROUTE_OWNER_NO_ORACLE_CHANGE",
    error: { name: error.name, message: error.message, stack: error.stack }, records
  }));
  process.exitCode = 1;
}
NODE
```

## Exact full expected return

Each of the seven fresh execution processes must report this complete value. The
array is ordered and must contain exactly these two strings, not dense hole keys.

```json
{
  "kind": "return",
  "value": {
    "detached": true,
    "alias": true,
    "backEdge": true,
    "cycle": true,
    "originalCount": 4,
    "clonedCount": 9,
    "sparseAlias": true,
    "sparseKeys": ["1", "3"],
    "sparseLength": 5,
    "explicitUndefined": true,
    "nestedDetached": true,
    "names": "alpha|beta"
  }
}
```

The native historical contract returns this complete summary, not unreturned
internal bindings. Additional public binding-graph signatures are therefore
compared across source, built and fresh replay runs, with explicit source-derived
invariants, rather than mislabeled as captured historical native internal graphs.
Their full typed nodes, genuine completed snapshots, and each fresh replay's
outputs/argv are retained by the command. No Map-value alias repair or PATCH4 case
is certified by this one unchanged structured profile.

## Executed bounded validation

The requested clone did not exist. It was created directly from remote main with
`git clone --single-branch --branch main` and immediately `git pull --ff-only`
returned `Already up to date.` SSH used strict existing-host-key checking and
disabled host-key updates; no feature branch, commit, push, home configuration
edit, or production edit occurred. The pinned base is
`eca93c7aad06e35a29ba0343217594677b4d136d`. Published OBJ002 commit
`6e3733a0df3b764a5d87d5f19fe6142bfed905f1` is its ancestor; no prerequisite
overlay or unpublished production patch was needed.

- Dependency installation passed with lifecycle scripts disabled and clone-local
  npm/XDG caches. Its retained deprecation/version notices are not code changes.
- The targeted SafeJS dependency build expanded to **67 tasks, all successful,
  zero cached**. Root post-build generation/bundling was not separately invoked;
  this is not a whole-repository build certification.
- The exact inline command ran successfully under Node **v22.22.2**. All seven
  fresh children exited zero without stderr: **one native anchor, two completed
  public source/built producers, and four fresh-process completed replays**.
- All seven complete return graphs match the unchanged expected/native summary.
  All six source/built/replayed selected binding graphs match, each with eleven
  nodes, holes `[false, true, false, true, false]`, length five, and own sparse
  keys `["1", "3"]`. Each SafeJS run used **109 steps**.
- Return-graph signature, SHA-256 over the compact JSON encoding of the newly
  observed typed graph:
  `9f60d71a7b3e02f561b12c73c92050d7fe5f8983b379274d3a5d0df870bfa434`.
- Six matching binding-graph signatures:
  `e6a2c0ea4743d7fc4e07bb4a01a0a077dcd99d41105d3d8bb2e21d0f6f07ec62`.
  These are this recipe's explicit portable data encodings, not recovered
  historical V8 fingerprints or claims about lost historical typed information.
- Existing published array-shape, OBJ002 validation, NUM/OBJ integration, and
  shadowed-array tests pass unchanged: **67 tests / four files**, no skips.
- Configured `tsc -p packages/safejs/tsconfig.json --noEmit` passes after build.
  No new unit test or TypeScript file is needed; new-test typechecks are therefore
  not applicable. The existing tests are used as published, not weakened.
- Plan formatting and strict new-file whitespace are checked before the immutable
  candidate capture. No repository-wide unit/lint/format gate is claimed here.

The recorded outer command includes its exact stdin and SHA-256. Every child has
its exact argv, entrypoint, timestamps, exit status, stdout/stderr, complete return
graph, and (for SafeJS) full binding graph and completed capture. Individual
completed snapshots are retained as JSON envelopes containing the exact original
snapshot string, byte count and hash; no newline or serialization rewrite changes
the bytes passed to fresh `restore` calls.

## Intake and remaining gates

This supplies a new recipe for H3
`oracle-index.json#/fieldResolutions/14`, field `nativeCurrentReplayCommands`,
assignment `EXEC-CLONE-1`. It does not mutate H3 or relabel its absent historical
native argv/replay generation as recovered. The old native/reference/historical
failure records remain verbatim in the captured inputs. No global H3 case/field
count is incremented by this worker; root/peer acceptance owns that update.

All captures here use execution semantics `jobs-v6`. The final publisher gate
must start new completed producers on its actual pinned published combination,
not rewrite version markers or reuse these snapshots as proof for a different
execution version. It must rerun the portable recipe after root/peer review and
complete the separately required composite gates. Boyle's pending
`COMPLETED-MAP-VALUE-ALIAS` and the separately assigned PATCH4 procedure are not
duplicated, normalized away, or closed by this result.

The only source-controlled candidate is this plan. Selected immutable input data,
typed observations, complete commands, completed snapshots and provenance receipts
belong under `out/safejs-remediation/exec-clone-1/`; no standalone QA runner is
added. The prior H3 initial-read chronology limitation remains explicit: 443
reported initial reads, 73 surviving envelopes, and 369 durable recovery reads do
not certify the unavailable initial per-read chronology. This task makes **zero
original audit payload reads** and reads only four previously guarded, explicitly
allowlisted, hash-bound source/result/config/report envelopes.
