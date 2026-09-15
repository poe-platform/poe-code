import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecNativeSlotCases, codecNativeSlotCancellationCases} from "./codec-native-slot-cases.js";

it.each(codecNativeSlotCases)("native codec slots: $name", ({source}) => {
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

it.each(codecNativeSlotCancellationCases)("keeps $name stage $stage cancellation fatal", ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0;
    const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() { reads++; controller.abort(); if (throws) throw Error("cancelled service"); return "ready\n"; }},
      output: {write() {}, flush() {}}});
    expect(session.exec(source)).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(session.eval("1")).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(reads).toBe(1);
  }
});

it("keeps slot mutation isolated between interpreters", () => {
  const options = {limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n] as const};
  const first = new PythonSession(options), second = new PythonSession(options);
  expect(first.exec("import codecs\ncodecs.IncrementalDecoder.__hash__ = None").status).toBe("ok");
  expect(second.exec("import codecs\nassert codecs.IncrementalDecoder.__hash__ is object.__hash__\nvalue = codecs.IncrementalDecoder()\nassert hash(value) == object.__hash__(value)").status).toBe("ok");
});
