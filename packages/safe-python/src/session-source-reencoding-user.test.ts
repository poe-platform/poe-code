import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/source-reencoding-user-3.14.7.json";

it.each(reference.cases)("source re-encoding public contract: $name", ({source, stdout}) => {
  let output = "";
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status, output).toBe("ok");
  expect(output).toBe(stdout);
});

it.each([false, true])("source re-encoding service cancellation is terminal (throws=%s)", throws => {
  const source = reference.cases.find(row => row.name === "service callback")!.source;
  const controller = new AbortController();
  let output = "", reads = 0;
  const session = new PythonSession({hashSeed: [1n, 2n], signal: controller.signal,
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {
      reads++;
      controller.abort();
      if (throws) throw new Error("service failed after cancellation");
      return "ready\n";
    }},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(session.exec("print('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(output).toBe("");
});
