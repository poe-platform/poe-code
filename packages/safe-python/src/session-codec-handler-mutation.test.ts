import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecHandlerMutationCases, codecHandlerMutationServiceCases} from "./codec-handler-mutation-cases.js";
import reference from "./runtime/__snapshots__/codec-handler-mutation-3.14.7.json" with {type: "json"};

it.each(codecHandlerMutationCases)("codec handler mutation: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name);
  expect(expected).toBeDefined();
  expect(expected!.source).toBe(source);
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) { output += text; }, flush() {}}
  });
  const result = session.exec(source);
  expect(result.status, output).toBe("ok");
  expect(output).toBe(expected!.stdout);
});

it.each(codecHandlerMutationServiceCases)("codec handler mutation service: $name", ({name, source}) => {
  const expected = reference.serviceCases.find(row => row.name === name);
  expect(expected).toBeDefined();
  expect(expected!.source).toBe(source);
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) { output += text; }, flush() {}},
    input: {readLine() { reads++; return "service\n"; }}
  });
  expect(session.exec(source).status, output).toBe("ok");
  expect(reads).toBe(1);
  expect(output).toBe(expected!.stdout);
});

it.each(codecHandlerMutationServiceCases)("cancels codec handler mutation: $name", ({source}) => {
  const controller = new AbortController();
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    output: {write(text) { output += text; }, flush() {}},
    input: {readLine() { reads++; controller.abort(); return "service\n"; }}
  });
  expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
