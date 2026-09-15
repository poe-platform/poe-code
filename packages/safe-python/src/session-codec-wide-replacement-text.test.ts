import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecWideReplacementTextCases, codecWideReplacementServiceCases} from "./codec-wide-replacement-text-cases.js";

it.each(codecWideReplacementTextCases)("wide replacement text: $name", ({source, stdout}) => {
  const output: string[] = [];
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) { output.push(text); }, flush() {}}});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(output.join("")).toBe(stdout);
});

it.each(codecWideReplacementServiceCases)("wide replacement service: $name", ({source, stdout}) => {
  const output: string[] = [];
  let reads = 0;
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], input: {readLine() { reads++; return "continue\n"; }},
    output: {write(text) { output.push(text); }, flush() {}}});
  expect(session.exec(source)).toMatchObject({status: "ok"});
  expect(reads).toBe(1);
  expect(output.join("")).toBe(stdout);
});

it.each(codecWideReplacementServiceCases)("wide replacement cancellation: $name", ({source}) => {
  const controller = new AbortController();
  const output: string[] = [];
  let reads = 0;
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "continue\n"; }},
    output: {write(text) { output.push(text); }, flush() {}}});
  expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toEqual([]);
  expect(session.exec("print('after cancellation')")).toMatchObject({status: "terminated", reason: "cancelled"});
});
