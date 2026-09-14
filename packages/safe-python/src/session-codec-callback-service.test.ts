import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecCallbackServiceCases} from "./codec-callback-service-cases.js";
import reference from "./runtime/__snapshots__/codec-callback-service-oracle.json" with {type: "json"};

const cases = codecCallbackServiceCases.flatMap(row => [1, 8, 250].map(stopAt => ({...row, stopAt})));
const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000};

it.each(cases)("$encoding unwinds service failure at callback $stopAt and repeats after reset", ({encoding, setup, run, stopAt}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little", recursionLimit: 1000});
  const expected = reference.cases.find(row => row.encoding === encoding && row.stopAt === stopAt)!;
  expect(expected.source).toBe(setup + run + run);
  expect(expected).toMatchObject({status: 0, stderr: ""});
  let reads = 0, output = "";
  const session = new PythonSession({
    limits, hashSeed: [1n, 2n],
    input: {readLine() {return ++reads % stopAt === 0 ? "stop\n" : "continue\n";}},
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(expected.source);
  expect(result, JSON.stringify({reads, output})).toEqual({status: "ok"});
  expect(reads).toBe(stopAt * 2);
  expect(output).toBe(expected.stdout);
});

it.each(cases.flatMap(row => [false, true].map(throwAfterAbort => ({...row, throwAfterAbort}))))(
  "$encoding cancels at callback $stopAt (service throws: $throwAfterAbort) without crossing interpreters",
  ({setup, run, independent, stopAt, throwAfterAbort}) => {
    const controller = new AbortController();
    let reads = 0, output = "", isolatedReads = 0;
    const session = new PythonSession({
      limits, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        if (++reads === stopAt) {
          controller.abort();
          if (throwAfterAbort) throw new Error("service failed after abort");
        }
        return "continue\n";
      }},
      output: {write(text) {output += text;}, flush() {}},
    });
    const isolated = new PythonSession({
      limits, hashSeed: [3n, 4n],
      input: {readLine() {isolatedReads++; return "stop\n";}},
      output: {write() {}, flush() {}},
    });
    expect(isolated.exec(setup)).toEqual({status: "ok"});
    const result = session.exec(setup + run);
    // Check isolation even when the recursive interpreter hit a host fault.
    expect(isolated.exec(independent)).toEqual({status: "ok"});
    expect(isolatedReads).toBe(0);
    expect(result, JSON.stringify({reads, output})).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(stopAt);
    expect(output).toBe("");
    expect(session.exec(run)).toEqual(result);
    expect(session.eval("1")).toEqual(result);
    expect(reads).toBe(stopAt);
    expect(output).toBe("");
  },
);

it.each(codecCallbackServiceCases.flatMap(row => [
  {reason: "steps", limits: {...limits, maxSteps: 250000}},
  {reason: "allocation", limits: {...limits, maxAllocatedBytes: 3000000}},
].map(policy => ({...row, ...policy}))))(
  "$encoding preserves the independent $reason budget during callback reentry",
  ({setup, run, reason, limits: policy}) => {
    let reads = 0, output = "";
    const session = new PythonSession({
      limits: policy, hashSeed: [1n, 2n],
      input: {readLine() {reads++; return "continue\n";}},
      output: {write(text) {output += text;}, flush() {}},
    });
    const result = session.exec(setup + run);
    expect(result).toMatchObject({status: "terminated", reason});
    expect(reads).toBeGreaterThan(0);
    expect(output).toBe("");
    const readsAtFailure = reads;
    expect(session.exec(run)).toEqual(result);
    expect(session.eval("1")).toEqual(result);
    expect(reads).toBe(readsAtFailure);
    expect(output).toBe("");
  },
);
