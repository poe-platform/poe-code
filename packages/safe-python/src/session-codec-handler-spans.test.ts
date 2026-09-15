import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecHandlerSpanCases} from "./codec-handler-span-cases.js";
import reference from "./runtime/__snapshots__/codec-handler-spans-3.14.7.json" with {type: "json"};

it.each(codecHandlerSpanCases)("preserves $handler span boundaries and error identity", ({handler, source}) => {
  expect(reference.target).toMatchObject({version: "3.14.7", unicode: "16.0.0", byteorder: "little", platform: "darwin"});
  const expected = reference.cases.find(row => row.handler === handler)!;
  expect(expected).toMatchObject({source, status: 0, stderr: ""});
  let stdout = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {stdout += text;}, flush() {}}
  });
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(stdout).toBe(expected.stdout);
  expect(stdout.split("\n").length - 1).toBe(108);
});
