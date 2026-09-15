import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecCallbackNestedServiceCases} from "./codec-callback-nested-service-cases.js";
import reference from "./runtime/__snapshots__/codec-callback-nested-service-oracle.json" with {type: "json"};

it.each(codecCallbackNestedServiceCases)("nested $encoding callbacks preserve failure, cleanup, reset and isolation across cancellation", ({encoding, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little", recursionLimit: 1000});
  const row = reference.cases.find(candidate => candidate.encoding === encoding)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0, output = "", independentReads = 0, independentOutput = "";
    const cancelled = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        if (reads === 3) {
          controller.abort();
          if (throws) throw new Error("service failed after cancellation");
        }
        return "continue\n";
      }},
      output: {write(text) {output += text;}, flush() {}},
    });
    const independent = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000},
      hashSeed: [3n, 4n],
      input: {readLine() {independentReads++; return independentReads % 3 === 0 ? "fail\n" : "continue\n";}},
      output: {write(text) {independentOutput += text;}, flush() {}},
    });
    const failure = cancelled.exec(source);
    expect(failure).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(reads).toBe(3);
    expect(output).toBe("");
    expect(cancelled.exec(source)).toEqual(failure);
    expect(cancelled.eval("1")).toEqual(failure);
    expect(reads).toBe(3);
    expect(independent.exec(source)).toEqual({status: "ok"});
    expect(independentReads).toBe(6);
    expect(independentOutput).toBe(row.stdout);
    independentOutput = "";
    expect(independent.exec(source)).toEqual({status: "ok"});
    expect(independentReads).toBe(12);
    expect(independentOutput).toBe(row.stdout);
  }
});
