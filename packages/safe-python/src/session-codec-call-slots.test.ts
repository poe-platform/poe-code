import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecCallSlotCases} from "./codec-call-slot-cases.js";

it.each(codecCallSlotCases)("codec call slots: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    input: {readLine: () => "ready\n"}, output: {write() {}, flush() {}}});
  const result = session.exec(source);
  let detail: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = diagnostic.value.primitive;
  }
  expect(result.status, String(detail)).toBe("ok");
});

it.each([false, true])("keeps call readiness cancellation fatal (throw=%s)", throws => {
  const controller = new AbortController();
  let reads = 0, writes = 0;
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); if (throws) throw Error("cancelled service"); return "ready\n"; }},
    output: {write() { writes++; }, flush() {}}});
  expect(session.exec(codecCallSlotCases.at(-1)!.source)).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
  expect(session.eval("1")).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
  expect(reads).toBe(1);
  expect(writes).toBe(0);
});

it("keeps call slot state isolated between interpreters", () => {
  const options = {limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n] as const};
  const first = new PythonSession(options), second = new PythonSession(options);
  expect(first.exec("import codecs\ncodecs.IncrementalDecoder.__call__ = lambda self: 61\nassert codecs.IncrementalDecoder()() == 61").status).toBe("ok");
  expect(second.exec("import codecs\nassert not callable(codecs.IncrementalDecoder())").status).toBe("ok");
});
