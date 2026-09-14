import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {sourceCodecTruncatedCases} from "./source-codec-truncated-cases.js";
import reference from "./runtime/__snapshots__/source-codec-truncated-3.14.7.json";

it.each(sourceCodecTruncatedCases)("source codec final buffer: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source)).toEqual({status: "ok"});
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});
