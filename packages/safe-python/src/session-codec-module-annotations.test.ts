import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecModuleAnnotationCases} from "./codec-module-annotation-cases.js";

it.each(codecModuleAnnotationCases)("codec module annotations: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], input: {readLine: () => "annotation\n"}, output: {write() {}, flush() {}}});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it("keeps cancellation in a module annotation callback terminal", () => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal, input: {readLine() {reads++; controller.abort(); return "annotation\n";}}, output: {write(text) {output += text;}, flush() {}}});
  expect(session.exec(codecModuleAnnotationCases.at(-1)!.source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
