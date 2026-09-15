import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecModuleDirCases} from "./codec-module-dir-cases.js";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(codecModuleDirCases)("codec module dir: $name", ({source}) => {
  let output = "";
  const session = new PythonSession({limits, hashSeed: [1n, 2n],
    input: {readLine() {return "visible\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("repr(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(output).toBe("verified\n");
});

it("cancels directory dictionary lookup without resuming the session", () => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({limits, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return "visible\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(codecModuleDirCases.at(-1)!.source);
  expect(result.status).toBe("terminated");
  if (result.status !== "terminated") throw Error("expected cancellation");
  expect(result.reason).toBe("cancelled");
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
