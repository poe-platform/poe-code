import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecReplacedInputMatrixCases} from "./codec-replaced-input-matrix-cases.js";
import reference from "./runtime/__snapshots__/codec-replaced-input-matrix-3.14.7.json" with {type: "json"};

it.each(codecReplacedInputMatrixCases)("codec replaced-input matrix: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name);
  expect(expected).toBeDefined();
  expect(expected!.source).toBe(source);
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    output: {write(text) { output += text; }, flush() {}}
  });
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(output).toBe(expected!.stdout);
});
