import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecKeywordUnicodeCases} from "./codec-keyword-unicode-cases.js";
import reference from "./runtime/__snapshots__/codec-keyword-unicode-3.14.7.json";

it.each(codecKeywordUnicodeCases)("preserves Unicode keyword diagnostics: $name", ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle).toMatchObject({source, status: 0, stderr: ""});
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  let output = "";
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], input: {readLine: () => "continue\n"}, output: {write(text) {output += text;}, flush() {}}});
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("repr(failure)");
    if (message.status === "ok") diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe("ok");
  expect(output).toBe(oracle.stdout);
});

it.each(codecKeywordUnicodeCases.flatMap(row => [false, true].map(throws => ({...row, throws}))))(
  "keeps keyword rendering cancellation terminal: $name (throws=$throws)", ({source, throws}) => {
    const controller = new AbortController();
    let reads = 0, writes = 0, flushes = 0;
    const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("service failed after cancellation");
        return "continue\n";
      }}, output: {write() {writes++;}, flush() {flushes++;}}});
    const result = session.exec(source);
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    const counts = [reads, writes, flushes];
    expect(session.exec("print('continued')")).toEqual(result);
    expect(session.eval("1")).toEqual(result);
    expect([reads, writes, flushes]).toEqual(counts);
  },
);
