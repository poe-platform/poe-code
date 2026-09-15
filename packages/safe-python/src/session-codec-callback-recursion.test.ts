import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecCallbackRecursionCases} from "./codec-callback-recursion-cases.js";
import reference from "./runtime/__snapshots__/codec-callback-recursion-lifecycle-oracle.json" with {type: "json"};

it.each(codecCallbackRecursionCases)("repeated $encoding callback recursion preserves exact tracebacks and reset", ({encoding, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little", recursionLimit: 1000});
  const row = reference.cases.find(candidate => candidate.encoding === encoding)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  expect(result, output).toEqual({status: "ok"});
  expect(output).toBe(row.stdout);
});
