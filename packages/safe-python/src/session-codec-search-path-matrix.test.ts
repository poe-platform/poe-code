import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSearchPathMatrixCases} from "./codec-search-path-matrix-cases.js";
import reference from "./runtime/__snapshots__/codec-search-path-matrix-3.14.7.json";

it.each(codecSearchPathMatrixCases)("$name", ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(oracle.source).toBe(source);
  expect(oracle.exitCode).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  expect(result.status, output).toBe("ok");
  expect(output).toBe(oracle.stdout);
});
