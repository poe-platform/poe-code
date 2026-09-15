import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecEmptySearchCases, codecEmptySearchCancellationCases} from "./codec-empty-search-cases.js";

it.each(codecEmptySearchCases)("empty codec search path: $name", ({source}) => {
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 8000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) { output += text; }, flush() {}},
  });
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("repr(failure)");
    if (message.status === "ok") detail = String(message.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(output).toBe("ok\n");
});

it.each(codecEmptySearchCancellationCases)("$name", ({source}) => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 8000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "cancel\n"; }},
    output: {write(text) { output += text; }, flush() {}},
  });
  expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
