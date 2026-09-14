import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecResumeValidationMatrixCases} from "./codec-resume-validation-matrix-cases.js";
import reference from "./runtime/__snapshots__/codec-resume-validation-matrix-3.14.7.json";

it("pins the recovery validation matrix to the target oracle", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.cases.map(row => row.name)).toEqual(codecResumeValidationMatrixCases.map(row => row.name));
});

it.each(codecResumeValidationMatrixCases)("codec recovery validation: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source)).toEqual({status: "ok"});
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});
