import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecFactoryCacheUserCases} from "./codec-factory-cache-user-cases.js";
import reference from "./runtime/__snapshots__/codec-factory-cache-user-3.14.7.json" with {type: "json"};

it.each(codecFactoryCacheUserCases)("codec factory lifecycle: $name", ({name, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  const row = reference.cases.find(candidate => candidate.name === name)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], input: {readLine() {reads++; return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source).status, output).toBe("ok");
  expect(output).toBe(row.stdout);
  expect(reads).toBe(1);
});

it.each(codecFactoryCacheUserCases)("codec factory cancellation: $name", ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let output = "", reads = 0;
    const session = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw Error("cancelled input service");
        return "continue\n";
      }},
      output: {write(text) {output += text;}, flush() {}},
    });
    expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.exec("pass")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(output).toBe("");
    expect(reads).toBe(1);
  }
});
