import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {sourceCodecTrailingTokenCases} from "./source-codec-trailing-token-cases.js";
import reference from "./runtime/__snapshots__/source-codec-trailing-token-3.14.7.json" with {type: "json"};

it.each(sourceCodecTrailingTokenCases)("decoded source trailing token: $name", ({name, source}) => {
  const row = reference.cases.find(candidate => candidate.name === name)!;
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(row.stdout);
});

it.each([false, true])("keeps source diagnostic cancellation terminal (throws=%s)", throws => {
  const controller = new AbortController();
  let writes = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    signal: controller.signal, hashSeed: [1n, 2n],
    output: {write() {writes++; controller.abort(); if (throws) throw Error("output failed");}, flush() {}}
  });
  const result = session.exec(sourceCodecTrailingTokenCases[0].source);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(writes).toBe(1);
  expect(session.exec("pass")).toEqual(result);
  expect(session.eval("1")).toEqual(result);
  expect(writes).toBe(1);
});
