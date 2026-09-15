import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {sourceCoreHandlerCases} from "./source-core-handler-cases.js";
import reference from "./runtime/__snapshots__/source-core-handler-3.14.7.json";

it.each(sourceCoreHandlerCases)("$name", ({name, source}) => {
  const row = reference.cases.find(row => row.name === name)!;
  expect(row.source).toBe(source);
  let output = "";
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  expect(result.status, output).toBe("ok");
  expect(output).toBe(row.stdout);
});

it.each([false, true])("source strict recovery cancellation stays terminal (throws=%s)", throws => {
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
  expect(session.exec(sourceCoreHandlerCases[8].source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("recover ascii\n");
  expect(session.exec("print('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(output).toBe("recover ascii\n");
});
