import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecStatefulEncoderUserCases} from "./codec-stateful-encoder-user-cases.js";
import reference from "./runtime/__snapshots__/stateful-encoder-user-oracle.json";

it.each(codecStatefulEncoderUserCases)("$name restores encoder state after recovery and guest failure", ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle).toMatchObject({source, status: 0, stderr: ""});
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  let output = "", reads = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {reads++; return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("repr(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(output).toBe(oracle.stdout);
  expect(reads).toBeGreaterThanOrEqual(3);
});

it.each(codecStatefulEncoderUserCases.flatMap(row => [false, true].map(throws => ({...row, throws}))))("$name keeps encoder recovery cancellation terminal (throws=$throws)", ({source, throws}) => {
    const controller = new AbortController();
    let reads = 0, writes = 0;
    const session = new PythonSession({
      hashSeed: [1n, 2n], signal: controller.signal,
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("input failed after cancellation");
        return "ready\n";
      }},
      output: {write() {writes++;}, flush() {}}
    });
    const result = session.exec(source);
    let detail: string | undefined;
    if (result.status === "exception") {
      session.globals.set("failure", result.exception);
      const diagnostic = session.eval("repr(failure)");
      if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
    }
    expect(result.status, detail).toBe("terminated");
    if (result.status === "terminated") expect(result.reason).toBe("cancelled");
    const before = writes;
    expect(session.exec("print('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    expect(writes).toBe(before);
});
