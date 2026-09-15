import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecIterationSlotCases} from "./codec-iteration-slot-cases.js";
import reference from "./runtime/__snapshots__/codec-iteration-slot-oracle.json" with {type: "json"};

it.each(codecIterationSlotCases)("codec iteration slots: $name", ({name, source}) => {
  const expected = reference.rows.find(row => row.name === name);
  expect(expected).toMatchObject({source, status: 0, stderr: ""});
  let output = "";
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    input: {readLine: () => "ready\n"}, output: {write(text) {output += text;}, flush() {}}});
  const result = session.exec(source);
  let detail: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = diagnostic.value.primitive;
  }
  expect(result.status, String(detail)).toBe("ok");
  expect(output).toBe(expected!.stdout);
});

it.each(codecIterationSlotCases.slice(-2).flatMap(row => [false, true].map(throws => ({...row, throws}))))(
  "keeps $name cancellation fatal (throw=$throws)", ({source, throws}) => {
    const controller = new AbortController();
    let reads = 0, writes = 0;
    const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() { reads++; controller.abort(); if (throws) throw Error("cancelled service"); return "ready\n"; }},
      output: {write() { writes++; }, flush() {}}});
    expect(session.exec(source)).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(session.eval("1")).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(reads).toBe(1);
    expect(writes).toBe(0);
  }
);

it("keeps iteration slots and intrinsic hashes isolated between interpreters", () => {
  const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};
  const first = new PythonSession({limits, hashSeed: [1n, 2n]});
  const second = new PythonSession({limits, hashSeed: [3n, 4n]});
  expect(first.exec("import codecs\ncodecs.IncrementalDecoder.__iter__ = lambda self: iter([7])\nassert list(codecs.IncrementalDecoder()) == [7]").status).toBe("ok");
  expect(second.exec("import codecs\nassert not hasattr(codecs.IncrementalDecoder, '__iter__')\ncodecs.IncrementalDecoder.__iter__ = lambda self: iter([9])\nassert list(codecs.IncrementalDecoder()) == [9]").status).toBe("ok");
  expect(first.exec("assert list(codecs.IncrementalDecoder()) == [7]").status).toBe("ok");
});
