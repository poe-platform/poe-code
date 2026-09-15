import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {sourceCodecFinalLineCases, sourceCodecEmptyExpressionCase} from "./source-codec-final-line-cases.js";
import reference from "./runtime/__snapshots__/source-codec-final-line-3.14.7.json";

it.each([...sourceCodecFinalLineCases, sourceCodecEmptyExpressionCase])("source decoding: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "final-cookie.py\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});
