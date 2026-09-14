import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecClassDocumentationCases, codecClassDocumentationCancellationSource} from "./codec-class-documentation-cases.js";
import reference from "./runtime/__snapshots__/codec-class-documentation-3.14.7.json" with {type: "json"};

it.each(codecClassDocumentationCases)("codec class documentation: $name", testCase => {
  const expected = reference.cases.find(row => row.name === testCase.name);
  expect(expected?.source).toBe(testCase.source);
  expect(expected?.validation).toEqual({status: 0, signal: null, stdout: "", stderr: ""});
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(testCase.source);
  let detail: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = diagnostic.value.primitive;
  }
  expect(result.status, String(detail)).toBe("exception" in testCase ? "exception" : "ok");
  if ("exception" in testCase) expect(session.exec(testCase.exception).status).toBe("ok");
});

it.each([1, 2].flatMap(at => [false, true].map(throws => ({at, throws}))))("keeps documentation callback cancellation terminal at $at (throws=$throws)", ({at, throws}) => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); if (throws) throw new Error("service cancelled"); return "cancelled\n"; }},
    output: {write() {}, flush() {}}
  });
  expect(session.exec(codecClassDocumentationCancellationSource(at))).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("assert False")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
});
