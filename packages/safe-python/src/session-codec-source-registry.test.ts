import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSourceRegistryCases} from "./codec-source-registry-cases.js";
import reference from "./runtime/__snapshots__/codec-source-registry-3.14.7.json";

it.each(codecSourceRegistryCases)("source registry: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  // Check the discriminant before a deep matcher can inspect opaque handles.
  // Keep the complete result/output assertion once execution has succeeded.
  expect(result.status, detail).toBe("ok");
  expect({result, output}).toEqual({result: {status: "ok"}, output: reference.cases.find(row => row.name === name)!.stdout});
});

it("keeps cancellation in source decoder callbacks terminal", () => {
  const controller = new AbortController();
  let output = "", reads = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n], signal: controller.signal,
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {reads++; controller.abort(); return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(codecSourceRegistryCases[2].source);
  expect(result.status).toBe("terminated");
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("search source_service\ndecode\n");
  expect(session.exec("print('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(output).toBe("search source_service\ndecode\n");
});
