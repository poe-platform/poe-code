import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecPlatformModuleCases, codecPlatformServiceCases} from "./codec-platform-module-cases.js";

it.each(codecPlatformModuleCases)("platform codec: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it.each(codecPlatformServiceCases)("platform codec service: $name", ({source}) => {
  let reads = 0, output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    input: {readLine() { reads++; return "service\n"; }},
    output: {write(text) { output += text; }, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(reads).toBe(1);
  expect(output).toBe("verified\n");
});

it("cancels while a platform codec import calls a guest module attribute hook", () => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "value\n"; }},
    output: {write() {}, flush() {}}
  });
  const result = session.exec(`
import codecs
def missing(name):
    input()
    raise AssertionError('continued after cancellation')
codecs.__getattr__ = missing
import encodings.mbcs
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
