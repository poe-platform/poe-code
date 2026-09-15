import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecTextInputPrecedenceCases} from "./codec-text-input-precedence-cases.js";
import reference from "./runtime/__snapshots__/codec-text-input-precedence.json";

it.each(codecTextInputPrecedenceCases)("text decoder argument precedence: $name", ({name, source}) => {
  expect(reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.unicode).toBe("16.0.0");
  expect(reference.platform).toBe("darwin");
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle.source).toBe(source);
  expect(oracle.exitCode).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(oracle.stdout);
});
