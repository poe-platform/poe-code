import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deserialize, serialize } from "node:v8";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

type Observation = Record<string, any>;
let source: string;
let profile: Observation;
let bundle: string;
let captured: Observation;
const identityKeys = ["sourceHash", "moduleId", "operation", "argumentDigest"];
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const apiMode = process.env.SAFEJS_O12_API ?? "source";
if (apiMode !== "source" && apiMode !== "built") throw Error("Invalid O12 API mode");

const childProgram = `
import { readFileSync } from 'node:fs';
import { serialize, deserialize } from 'node:v8';
const input = deserialize(readFileSync(0));
const publicRuntimeURL = input.apiMode === 'built' ? import.meta.resolve('@poe-code/safe-js') : 'source-bundle';
const api = await import(input.apiMode === 'built' ? '@poe-code/safe-js' : 'data:text/javascript;base64,' + input.bundle);
const calls = [];
const hostTrace = [];
const acknowledgements = [];
const requests = [];
const proofs = [];
const pending = new Map();
let saved;
let model = input.model;
let leftReceiptBefore;
const finish = async result => {
  const output = serialize({ ...result, calls, hostTrace, acknowledgements, requests, proofs, saved, model,
  outputPadding: input.outputPadding,
  leftReceiptUnchanged: leftReceiptBefore === undefined || leftReceiptBefore.equals(serialize(model.receipts.left)),
  apiMode: input.apiMode, publicRuntimeURL });
  await new Promise((resolve, reject) => {
    process.stdout.write(output, error => error ? reject(error) : resolve());
  });
  process.exit(0);
};
const timer = setTimeout(() => finish({ status: 'timeout', pending: [...pending.keys()] }), 3000);
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
function fixture(left, right) {
  return {
    fixture: { ...structuredClone(input.profile.fixtureData), primary: left, again: left,
      nested: { promise: left }, remoteMirror: right },
    incoming: { remote: right, again: right }
  };
}
function ackBoundary(label) {
  acknowledgements.push('boundary:' + label);
  hostTrace.push(['ack', 'boundary', label]);
}
function observeLeft(value) {
  const nodes = [value, value.events, ...value.events];
  return {
    nodes,
    prototypes: nodes.map(node => Object.getPrototypeOf(node) === null ? 'null'
      : Object.getPrototypeOf(node) === Array.prototype ? 'array'
      : Object.getPrototypeOf(node) === Object.prototype ? 'ordinary' : 'other'),
    extensible: nodes.map(node => Object.isExtensible(node)),
    keys: nodes.map(node => Reflect.ownKeys(node)),
    descriptors: nodes.map(node => Object.getOwnPropertyDescriptors(node))
  };
}
try {
  if (input.mode === 'capture' || input.mode === 'raw') {
    const actualError = new Error(input.profile.receipts.right.reason.message);
    const reason = Object.fromEntries(Object.getOwnPropertyNames(actualError).map(key => [key, actualError[key]]));
    reason.name = actualError.name;
    model = { actualError, reason, reasonAgain: reason, reasonGraph: [reason, { reason }],
      receipts: { left: structuredClone(input.profile.receipts.left), right: { status: 'rejected', reason } } };
    leftReceiptBefore = serialize(model.receipts.left);
    model.nativeLeft = observeLeft(model.receipts.left.value);
    const nativeLeft = deferred();
    const nativeRight = deferred();
    const nativeGraph = fixture(nativeLeft.promise, nativeRight.promise);
    const nativeBoundary = async label => {
      if (label === 'both-pending') nativeRight.reject(actualError);
      if (label === 'after:right') nativeLeft.resolve(model.receipts.left.value);
      return { boundary: label };
    };
    const nativeFunction = new Function('incoming', 'boundary', 'return ' + input.source.slice('export default '.length))(nativeGraph.incoming, nativeBoundary);
    const nativeValue = await nativeFunction(nativeGraph.fixture);
    const nativeRepeatedReason = await nativeRight.promise.catch(error => error);
    model.nativeValue = nativeValue;
    model.nativeReasonIsOriginal = nativeRepeatedReason === actualError;
    const left = deferred();
    const right = deferred();
    const rawGraph = fixture(left.promise, right.promise);
    const graph = input.mode === 'raw' ? rawGraph : api.deepCopyToSandbox(rawGraph);
    const gate = deferred();
    const ackInput = key => {
      const outcome = model.receipts[key];
      acknowledgements.push('input:' + key);
      hostTrace.push(['ack', 'input', key, outcome.status]);
      if (key === 'right') right.reject(input.mode === 'raw' ? actualError : outcome.reason);
      else left.resolve(outcome.value);
    };
    Date.now = () => 0;
    const boundary = api.declareHostOperation(async label => {
      calls.push(label);
      hostTrace.push(['call', 'boundary', label]);
      if (label === 'both-pending') {
        Date.now = () => 2;
        await gate.promise;
      }
      ackBoundary(label);
      if (label === 'both-pending') ackInput('right');
      if (label === 'after:right') ackInput('left');
      return { boundary: label };
    }, 're-issue');
    const result = await api.run(input.source, {
      entryPointArgs: [graph.fixture], bindings: { incoming: graph.incoming, boundary },
      budget: new api.Budget({ maxSteps: 75000, maxCallDepth: 80, dataSize: 3000000 }),
      snapshotIntervalMs: 1,
      snapshotBackend: { async read() {}, async remove() {}, async write(snapshot) {
        if (saved === undefined) saved = JSON.parse(await api.dump({ snapshot }));
        gate.resolve();
      } }
    });
    const rightRecord = result.snapshot.hostCalls.find(call => call.moduleId === '<inputs>' && call.operation === JSON.stringify(['bindings', 'incoming', 'remote']));
    const capturedReason = rightRecord.outcome.reason;
    const leftRecord = result.snapshot.hostCalls.find(call => call.moduleId === '<inputs>' && call.operation === JSON.stringify(['entryPointArgs', '0', 'primary']));
    model.capturedLeft = observeLeft(leftRecord.outcome.value);
    const completed = JSON.parse(await api.dump(result));
    model.capturedReasonGraph = completed.replay.calls.find(call => call.id === rightRecord.id).outcome.data;
    model.capturedReason = capturedReason;
    model.receiptSnapshot = completed;
    await finish({ status: result.ok ? 'ok' : 'failed', value: result.returnValue, nativeValue,
      nativeReasonIsOriginal: nativeRepeatedReason === actualError,
      nativeReasonStack: nativeRepeatedReason.stack,
      rawReturnNullPrototype: Object.getPrototypeOf(result.returnValue) === null,
      completed });
  }
  const receiptCalls = [];
  const receiptRequests = [];
  const receiptResult = await api.run(input.source, {
    snapshot: api.restore(model.receiptSnapshot, { source: input.source }),
    bindings: { boundary: api.declareHostOperation(async label => {
      receiptCalls.push(label);
      throw Error('Completed receipt recovery must not reissue a host operation');
    }, 're-issue') },
    hostCallResumeProvider(request) {
      receiptRequests.push(request);
      throw Error('Completed receipt recovery must not request another proof');
    },
    budget: new api.Budget({ maxSteps: 75000, maxCallDepth: 80, dataSize: 3000000 })
  });
  if (!receiptResult.ok) throw Error('Completed receipt recovery failed');
  const receiptRecord = receiptResult.snapshot.hostCalls.find(call => call.moduleId === '<inputs>' && call.operation === JSON.stringify(['bindings', 'incoming', 'remote']));
  if (receiptRecord.outcome.status !== 'rejected') throw Error('Missing captured rejected receipt');
  const receiptReason = receiptRecord.outcome.reason;
  model.decodedReasonGraph = { reason: receiptReason, again: receiptReason, nested: { reason: receiptReason } };
  model.receiptRecovery = { value: receiptResult.returnValue, calls: receiptCalls, requests: receiptRequests,
    completed: JSON.parse(await api.dump(receiptResult)), callId: receiptRecord.id };
  const ackInput = key => {
    const entry = pending.get(key);
    if (entry === undefined) throw Error('Missing pending proof for ' + key);
    const originalOutcome = model.receipts[key];
    const completeReason = model.decodedReasonGraph.reason;
    let outcome;
    if (key === 'left') {
      leftReceiptBefore = serialize(originalOutcome);
      model.nativeLeft = observeLeft(originalOutcome.value);
      const value = input.leftDomain === 'raw-left' ? originalOutcome.value
        : input.leftDomain === 'genuine-null-left'
          ? Object.assign(Object.create(null), { name: originalOutcome.value.name,
              events: originalOutcome.value.events.map(event => Object.assign(Object.create(null), event)) })
          : api.deepCopyToSandbox(originalOutcome.value);
      model.suppliedLeft = observeLeft(value);
      model.leftUsesOriginalRecord = value === originalOutcome.value;
      outcome = { status: 'fulfilled', value };
    } else outcome = input.projection === 'native-fields' ? originalOutcome
      : input.projection === 'minimal'
        ? { status: 'rejected', reason: { name: completeReason.name, message: completeReason.message } }
        : { status: 'rejected', reason: completeReason };
    const { callId, sourceHash, moduleId, operation, argumentDigest } = entry.request;
    const proof = { callId, sourceHash, moduleId, operation, argumentDigest, outcome };
    proofs.push({ request: entry.request, proof, callbacks: entry.callbacks,
      modeledReasonIdentity: key !== 'right' || outcome.reason === completeReason });
    acknowledgements.push('input:' + key);
    hostTrace.push(['ack', 'input', key, outcome.status]);
    pending.delete(key);
    entry.resolve(proof);
  };
  const boundary = api.declareHostOperation(async label => {
    calls.push(label);
    hostTrace.push(['call', 'boundary', label]);
    ackBoundary(label);
    if (label === 'both-pending') ackInput('right');
    if (label === 'after:right') ackInput('left');
    return { boundary: label };
  }, 're-issue');
  const provider = (request, context) => {
    requests.push(request);
    const key = request.operation === JSON.stringify(['bindings', 'incoming', 'remote']) ? 'right'
      : request.operation === JSON.stringify(['entryPointArgs', '0', 'primary']) ? 'left' : undefined;
    if (key === undefined || request.moduleId !== '<inputs>') throw Error('Unexpected input request');
    const record = input.snapshot.replay.calls.find(call => call.id === request.callId);
    for (const field of ['sourceHash', 'moduleId', 'operation', 'argumentDigest'])
      if (record?.[field] !== request[field]) throw Error('Proof identity mismatch: ' + field);
    if (pending.has(key)) throw Error('Duplicate proof request');
    return new Promise(resolve => pending.set(key, { request, resolve, callbacks: context?.callbacks.size ?? 0 }));
  };
  const result = await api.run(input.source, {
    snapshot: api.restore(input.snapshot, { source: input.source }), bindings: { boundary },
    hostCallResumeProvider: provider,
    budget: new api.Budget({ maxSteps: 75000, maxCallDepth: 80, dataSize: 3000000 })
  });
  const completed = JSON.parse(await api.dump(result));
  for (const entry of proofs) {
    const record = result.snapshot.hostCalls.find(call => call.id === entry.proof.callId);
    entry.acceptedOutcome = record.outcome;
    entry.encodedOutcome = completed.replay.calls.find(call => call.id === entry.proof.callId).outcome.data;
  }
  await finish({ status: result.ok ? 'ok' : 'failed', value: result.returnValue,
    completed, pending: [...pending.keys()] });
} catch (error) { await finish({ status: 'error', error,
  errorProperties: Object.fromEntries(Object.getOwnPropertyNames(error).map(key => [key, error[key]])) }); }
finally { clearTimeout(timer); }
`;

async function observe(
  mode: string,
  projection?: string,
  snapshot?: unknown,
  leftDomain = "modeled",
  outputPadding?: string
) {
  const observation = await new Promise<Observation>((accept, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", childProgram], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const output: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Child deadline: " + stderr));
    }, 5000);
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error(`Child ${code}: ${stderr}`));
      try {
        accept(deserialize(Buffer.concat(output)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(
      serialize({
        bundle,
        source,
        profile,
        mode,
        projection,
        leftDomain,
        outputPadding,
        snapshot,
        model: captured?.model,
        apiMode
      })
    );
  });
  console.log(
    JSON.stringify({
      mode,
      projection,
      leftDomain,
      apiMode,
      publicRuntimeURL: observation.publicRuntimeURL,
      typedV8Base64: serialize(observation).toString("base64"),
      status: observation.status,
      error: observation.error?.message,
      value: observation.value,
      requests: observation.requests,
      proofs: observation.proofs,
      acknowledgements: observation.acknowledgements
    })
  );
  return observation;
}

function expectLeftProvenance(provenance: Observation, nullPrototype: boolean) {
  const native = profile.receipts.left.value;
  const expectedNodes = [native, native.events, ...native.events];
  expect(provenance.nodes).toEqual(expectedNodes);
  const recordPrototype = nullPrototype ? "null" : "ordinary";
  expect(provenance.prototypes).toEqual([
    recordPrototype,
    "array",
    recordPrototype,
    recordPrototype
  ]);
  expect(provenance.extensible).toEqual([true, true, true, true]);
  expect(provenance.keys).toEqual(expectedNodes.map((node) => Reflect.ownKeys(node)));
  expect(provenance.descriptors).toEqual(
    expectedNodes.map((node) => Object.getOwnPropertyDescriptors(node))
  );
  expect(provenance.nodes[0].events).toBe(provenance.nodes[1]);
  expect(provenance.nodes[1][0]).toBe(provenance.nodes[2]);
  expect(provenance.nodes[1][1]).toBe(provenance.nodes[3]);
  expect(provenance.nodes[2]).not.toBe(provenance.nodes[3]);
  expect(provenance.descriptors[0].events.value).toBe(provenance.nodes[1]);
  expect(provenance.descriptors[1][0].value).toBe(provenance.nodes[2]);
  expect(provenance.descriptors[1][1].value).toBe(provenance.nodes[3]);
}

beforeAll(async () => {
  const originals: Record<string, string> = {};
  for (const [name, hash] of [
    ["01-input-batch-scan.ajs", "8344978a75b367325409f07193a28977225c5c833a65e5a14537f2fd9b5cb005"],
    ["expectations.fixture", "00513a4fddf25e46365c7cd51e981fda86b785f3fdedf8cf85983e6cdc56505c"]
  ]) {
    originals[name] = readFileSync(
      new URL(`../fixtures/input-error-projection/${name}`, import.meta.url),
      "utf8"
    );
    expect(createHash("sha256").update(originals[name]).digest("hex")).toBe(hash);
  }
  source = originals["01-input-batch-scan.ajs"];
  profile = JSON.parse(originals["expectations.fixture"]).profiles[1];
  if (apiMode === "built") {
    bundle = "";
    captured = await observe("capture");
    return;
  }
  const compiled = await build({
    stdin: {
      contents:
        "export { run, dump, restore, declareHostOperation, deepCopyToSandbox, Budget } from './packages/safe-js/src/index.ts';",
      resolveDir: repositoryRoot,
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    plugins: [
      {
        name: "absolute-package-imports",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^[^./]/ }, async (args) => {
            if (args.path.startsWith("node:") || args.pluginData) return;
            const resolved = await buildApi.resolve(args.path, {
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: true
            });
            if (resolved.path && !resolved.external)
              return { path: pathToFileURL(resolved.path).href, external: true };
          });
        }
      }
    ]
  });
  bundle = Buffer.from(compiled.outputFiles[0].text).toString("base64");
  captured = await observe("capture");
});

describe("O12 exact modeled Error proof projection", () => {
  it("flushes the complete serialized observation beyond the pipe buffer", async () => {
    const outputPadding = "0123456789abcdef".repeat(65_536);
    const observation = await observe(
      "restore",
      "complete",
      captured.completed,
      "modeled",
      outputPadding
    );

    expect(observation.status).toBe("ok");
    expect(observation.outputPadding).toBe(outputPadding);
    expect(observation.value).toEqual(profile.expected);
    expect(observation.model.actualError).toBeInstanceOf(Error);
    expect(observation.model.reason).toBe(observation.model.reasonAgain);
    expect(observation.calls).toEqual([]);
    expect(observation.requests).toEqual([]);
  });

  it("captures the unchanged original profile with complete native values and provenance", () => {
    expect(captured.status).toBe("ok");
    expect(captured.nativeReasonIsOriginal).toBe(true);
    expect(captured.leftReceiptUnchanged).toBe(true);
    expectLeftProvenance(captured.model.nativeLeft, false);
    expectLeftProvenance(captured.model.capturedLeft, true);
    expect(captured.nativeValue).toEqual(profile.expected);
    expect(captured.value).toEqual(captured.nativeValue);
    expect(captured.model.reason.stack).toBe(captured.nativeReasonStack);
    expect(captured.model.actualError).toBeInstanceOf(Error);
    expect(captured.model.reason).toBe(captured.model.reasonAgain);
    expect(captured.model.reason).toBe(captured.model.reasonGraph[0]);
    expect(captured.model.reason).toBe(captured.model.reasonGraph[1].reason);
    const reasonGraph = captured.model.capturedReasonGraph;
    expect(reasonGraph.nodes[reasonGraph.root.id].errorType).toBe("Error");
    expect(captured.calls).toEqual(profile.expectedCalls);
    expect(captured.hostTrace).toEqual(profile.expectedHostTrace);
    expect(captured.acknowledgements).toEqual(profile.expectedAcks);
    expect(captured.saved.executionSemantics).toBe("jobs-v8");
    expect(
      captured.saved.replay.calls.filter((call: Observation) => call.moduleId === "<inputs>")
    ).toHaveLength(2);
  });

  for (const { projection, repeats, leftDomain } of [
    ...["complete", "minimal", "native-fields"].map((projection) => ({
      projection,
      repeats: [1, 2],
      leftDomain: "modeled"
    })),
    { projection: "complete", repeats: [1], leftDomain: "raw-left" },
    { projection: "complete", repeats: [1], leftDomain: "genuine-null-left" }
  ])
    for (const repeat of repeats) {
      const title =
        leftDomain === "modeled"
          ? `classifies ${projection} proof ${repeat} against the same capture and request`
          : `preserves ${leftDomain} proof provenance with the complete right receipt`;
      it(title, async () => {
        expect(captured.status).toBe("ok");
        const before = serialize(captured.saved);
        const receiptBefore = serialize(captured.model.receiptSnapshot);
        const resumed = await observe("restore", projection, captured.saved, leftDomain);
        expect(resumed.status).toBe("ok");
        expect(resumed.leftReceiptUnchanged).toBe(true);
        expectLeftProvenance(resumed.model.nativeLeft, false);
        expectLeftProvenance(resumed.model.suppliedLeft, leftDomain !== "raw-left");
        expect(resumed.model.leftUsesOriginalRecord).toBe(leftDomain === "raw-left");
        expect(resumed.model.receiptRecovery.value).toEqual(captured.value);
        expect(resumed.model.receiptRecovery.calls).toEqual([]);
        expect(resumed.model.receiptRecovery.requests).toEqual([]);
        expect(resumed.model.receiptRecovery.completed).toEqual(captured.completed);
        expect(resumed.model.decodedReasonGraph.reason).toEqual(captured.model.capturedReason);
        expect(resumed.model.decodedReasonGraph.reason).toBe(
          resumed.model.decodedReasonGraph.again
        );
        expect(resumed.model.decodedReasonGraph.reason).toBe(
          resumed.model.decodedReasonGraph.nested.reason
        );
        const expected = structuredClone(captured.nativeValue);
        expect(resumed.value).toEqual(expected);
        if (projection === "minimal") {
          expect(resumed.value.inputOutcomes[0].same).toBe(true);
          expect(resumed.value.trace[2][4]).toBe(true);
          const rejectedProof = resumed.proofs.find(
            (entry: Observation) => entry.proof.outcome.status === "rejected"
          );
          const recorded = captured.completed.replay.calls.find(
            (call: Observation) => call.id === rejectedProof.proof.callId
          );
          const expectedMinimalData = {
            root: { tag: "ref", id: 0 },
            nodes: [
              {
                kind: "object",
                nullPrototype: false,
                extensible: true,
                properties: {
                  name: { value: "Error", configurable: true, enumerable: true, writable: true },
                  message: {
                    value: "right input unavailable",
                    configurable: true,
                    enumerable: true,
                    writable: true
                  }
                }
              }
            ]
          };
          expect(rejectedProof.modeledReasonIdentity).toBe(false);
          expect(rejectedProof.proof.outcome.reason).not.toBe(
            resumed.model.decodedReasonGraph.reason
          );
          expect(Object.getOwnPropertyNames(rejectedProof.proof.outcome.reason).sort()).toEqual([
            "message",
            "name"
          ]);
          expect(Object.hasOwn(rejectedProof.proof.outcome.reason, "stack")).toBe(false);
          expect(rejectedProof.encodedOutcome).toEqual(expectedMinimalData);
          expect(Object.hasOwn(rejectedProof.encodedOutcome.nodes[0], "errorType")).toBe(false);
          expect(Object.hasOwn(rejectedProof.encodedOutcome.nodes[0].properties, "stack")).toBe(
            false
          );
          expect(rejectedProof.encodedOutcome).not.toEqual(recorded.outcome.data);
          const expectedMinimalJournal = structuredClone(captured.completed.replay);
          const expectedMinimalOutcome = expectedMinimalJournal.calls.find(
            (call: Observation) => call.id === recorded.id
          ).outcome.data;
          delete expectedMinimalOutcome.nodes[0].errorType;
          delete expectedMinimalOutcome.nodes[0].properties.stack;
          expect(expectedMinimalOutcome).toEqual(expectedMinimalData);
          expect(resumed.completed.replay).toEqual(expectedMinimalJournal);
          expect(resumed.completed.replay).not.toEqual(captured.completed.replay);
        }
        expect(resumed.calls).toEqual(profile.expectedCalls);
        expect(resumed.hostTrace).toEqual(profile.expectedHostTrace);
        expect(resumed.acknowledgements).toEqual(profile.expectedAcks);
        expect(resumed.pending).toEqual([]);
        expect(resumed.proofs).toHaveLength(2);
        expect(resumed.requests).toHaveLength(2);
        for (const entry of resumed.proofs) {
          const record = captured.saved.replay.calls.find(
            (call: Observation) => call.id === entry.request.callId
          );
          expect(entry.proof.callId).toBe(record.id);
          expect(entry.request.runId).toBe(record.runId);
          expect(entry.request.lifecycle).toBe(record.lifecycle);
          expect(entry.request.policy).toBe("read-side-effect");
          expect(entry.request.asynchronous).toBe(true);
          expect(entry.request.requirement).toBe("external-reconciliation");
          for (const key of identityKeys) {
            expect(entry.request[key]).toBe(record[key]);
            expect(entry.proof[key]).toBe(record[key]);
          }
          expect(entry.callbacks).toBe(0);
          expect(entry.acceptedOutcome).toEqual(entry.proof.outcome);
          if (entry.proof.outcome.status === "rejected") {
            expect(entry.proof.callId).toBe(resumed.model.receiptRecovery.callId);
            expect(entry.modeledReasonIdentity).toBe(projection === "complete");
            if (projection === "complete") {
              expect(entry.proof.outcome.reason).toBe(resumed.model.decodedReasonGraph.reason);
              expect(entry.proof.outcome.reason.stack).toBe(captured.model.capturedReason.stack);
              const recorded = captured.completed.replay.calls.find(
                (call: Observation) => call.id === record.id
              );
              expect(entry.encodedOutcome).toEqual(recorded.outcome.data);
            } else if (projection === "minimal") {
              expect(Object.keys(entry.proof.outcome.reason).sort()).toEqual(["message", "name"]);
            } else {
              expect(entry.proof.outcome.reason).toBe(resumed.model.reason);
              expect(entry.proof.outcome.reason.stack).toBe(captured.model.actualError.stack);
            }
          }
        }
        const calls = resumed.completed.replay.calls;
        expect(calls).toHaveLength(5);
        expect(calls.every((call: Observation) => call.lifecycle === "consumed")).toBe(true);
        if (leftDomain === "raw-left") {
          const expectedRawJournal = structuredClone(captured.completed.replay);
          const expectedLeft = expectedRawJournal.calls.find(
            (call: Observation) =>
              call.moduleId === "<inputs>" &&
              call.operation === JSON.stringify(["entryPointArgs", "0", "primary"])
          ).outcome.data;
          for (const nodeId of [0, 2, 3]) {
            expect(expectedLeft.nodes[nodeId].kind).toBe("object");
            expect(expectedLeft.nodes[nodeId].nullPrototype).toBe(true);
            expectedLeft.nodes[nodeId].nullPrototype = false;
          }
          expect(resumed.completed.replay).toEqual(expectedRawJournal);
          expect(resumed.completed.replay).not.toEqual(captured.completed.replay);
        } else if (projection === "complete")
          expect(resumed.completed.replay).toEqual(captured.completed.replay);
        expect(resumed.completed.initialInputs).toEqual(captured.saved.initialInputs);
        const recorded = captured.saved.promiseReplay.settlements;
        expect(resumed.completed.promiseReplay.settlements.slice(0, recorded.length)).toEqual(
          recorded
        );
        expect(serialize(captured.saved)).toEqual(before);
        expect(serialize(captured.model.receiptSnapshot)).toEqual(receiptBefore);
        const completedReplay = await observe("restore", projection, resumed.completed, leftDomain);
        expect(completedReplay.status).toBe("ok");
        expect(completedReplay.value).toEqual(expected);
        expect(completedReplay.calls).toEqual([]);
        expect(completedReplay.requests).toEqual([]);
        expect(completedReplay.completed.replay).toEqual(resumed.completed.replay);
        expect(completedReplay.completed.promiseReplay).toEqual(resumed.completed.promiseReplay);
      });
    }

  it("records raw public-input qualification without substituting it for O12", async () => {
    const raw = await observe("raw");
    expect(raw.status).toBe("error");
    expect(raw.errorProperties.name).toBe("UnhandledRejectionError");
    expect(raw.error.message).toContain("Unsupported sandbox value at <root>: Error");
    expect(raw.saved.executionSemantics).toBe("jobs-v8");
    expect(raw.model.actualError).toBeInstanceOf(Error);
    expect(raw.model.nativeValue).toEqual(profile.expected);
    expect(raw.model.nativeReasonIsOriginal).toBe(true);
    expect(raw.requests).toEqual([]);
  });
});
