import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecErrorRangeUserCases} from "./codec-error-range-user-cases.js";
import evidence from "./runtime/__snapshots__/codec-error-range-user-services.json";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(codecErrorRangeUserCases)("standard handler range contract: $name", ({name, source}) => {
  const row = evidence.rows.find(candidate => candidate.name === name)!;
  expect(evidence.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(evidence.reference.unicode).toBe("16.0.0");
  expect(row.source).toBe(source);
  expect(row.oracle).toMatchObject({status: 0, stderr: ""});
  expect(row.guest).toMatchObject({status: "ok", stdout: row.oracle.stdout, reads: 1, matches: true});
  let output = "", reads = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n], limits,
    input: {readLine() {reads++; return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(row.oracle.stdout);
  expect(reads).toBe(1);
});

it.each([false, true])("handler range audit cancellation remains terminal (throws=%s)", throws => {
  for (const {name, source} of codecErrorRangeUserCases) {
    const recorded = evidence.rows.find(row => row.name === name)!.cancellations.find(row => row.throws === throws)!;
    expect(recorded).toMatchObject({result: {status: "terminated", reason: "cancelled"}, reads: 1, writes: 0, execIdentity: true, evalIdentity: true});
    const controller = new AbortController();
    let reads = 0, writes = 0;
    const session = new PythonSession({
      hashSeed: [1n, 2n], limits, signal: controller.signal,
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("read cancelled");
        return "ready\n";
      }},
      output: {write() {writes++;}, flush() {}}
    });
    const result = session.exec(source);
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.exec("1")).toBe(result);
    expect(session.eval("1")).toBe(result);
    expect(reads).toBe(1);
    expect(writes).toBe(0);
  }
});
