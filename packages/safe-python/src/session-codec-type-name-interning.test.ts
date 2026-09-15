import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecTypeNameInterningCases, codecTypeNameFailureSource, codecTypeNameCancellationSource} from "./codec-type-name-interning-cases.js";

it.each(codecTypeNameInterningCases)("uses the interned $name lookup name when constructing codec subclasses", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = diagnostic.value.primitive;
  }
  expect(result.status, String(detail)).toBe("ok");
});

it("preserves failures from codec class namespace equality callbacks", () => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  expect(session.exec(codecTypeNameFailureSource).status).toBe("ok");
});

it.each([false, true])("keeps codec class namespace cancellation fatal (throws=%s)", throws => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); if (throws) throw new Error("service cancelled"); return "cancelled\n"; }},
    output: {write() {}, flush() {}}
  });
  expect(session.exec(codecTypeNameCancellationSource)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("assert False")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
});
