import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecIncrementalCallbackUserCases} from "./codec-incremental-callback-user-cases.js";
import reference from "./runtime/__snapshots__/codec-incremental-callback-user-oracle.json" with {type: "json"};

it.each(codecIncrementalCallbackUserCases)("incremental callback user audit: $name", ({name, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(reference.reference.recursionLimit).toBe(1000);
  const row = reference.cases.find(candidate => candidate.name === name)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  expect(result.status, result.status === "terminated" ? JSON.stringify(result) : output).toBe("ok");
  expect(output).toBe(row.stdout);
});
