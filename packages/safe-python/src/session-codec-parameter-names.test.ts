import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecParameterNameCases, codecParameterDefaultCases, codecParameterServiceCases} from "./codec-parameter-name-cases.js";
import reference from "./runtime/__snapshots__/codec-parameter-names-3.14.7.json";

it.each(codecParameterNameCases)("interns $name constructor parameter names before guest equality", ({source}) => {
  let output = "";
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}});
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(output).toBe("[('self', True), ('errors', True)] replace\n");
});

it.each(codecParameterDefaultCases)("interns $name keyword-only default lookup names", ({source}) => {
  let output = "";
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}});
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe("[('errors', True)] replace\n");
});

it.each(codecParameterServiceCases)("preserves $name guest failure and cancellation", ({name, source}) => {
  for (const cancel of [false, true]) {
    for (const throws of cancel ? [false, true] : [false]) {
      const controller = new AbortController();
      let reads = 0, output = "";
      const session = new PythonSession({hashSeed: [1n, 2n], signal: controller.signal,
        limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
        input: {readLine() {reads++; if (cancel) controller.abort(); if (throws) throw Error("service failed"); return "continue\n";}},
        output: {write(text) {output += text;}, flush() {}}});
      const result = session.exec(source);
      if (cancel) {
        expect(result).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
        expect(session.eval("1")).toBe(result);
        expect(output).toBe("");
      } else {
        expect(result.status).toBe("ok");
        expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
      }
      expect(reads).toBe(1);
    }
  }
});
