import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {importModuleFilenameCases} from "./import-module-filename-cases.js";

it.each(importModuleFilenameCases)("module filename: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it("keeps cancellation in filename formatting fatal", () => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "value\n"; }},
    output: {write() {}, flush() {}}
  });
  const result = session.exec(`
import codecs
class Path(str):
    def __str__(self):
        input()
        raise AssertionError('continued after cancellation')
module = type(codecs)('probe')
module.__file__ = Path('/guest/probe.py')
__builtins__['__import__'] = lambda *args: module
from probe import absent
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
