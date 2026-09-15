import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecImportParentCases} from "./codec-import-parent-cases.js";
import oracle from "./runtime/__snapshots__/codec-import-parents-3.14.7.json";

it.each(codecImportParentCases)("codec import parent: $name", ({name, source}) => {
  expect(oracle.cases.find(test => test.name === name)).toMatchObject({source, status: 0, signal: null, stdout: "", stderr: ""});
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

it("keeps cancellation in a package path descriptor terminal", () => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return "ignored\n";}}, output: {write() {}, flush() {}}
  });
  const result = session.exec(`
import encodings
class Package(type(encodings)):
    @property
    def __path__(self):
        input()
        raise AssertionError('continued after cancellation')
encodings.__class__ = Package
try:
    import encodings.ascii
except BaseException:
    raise AssertionError('caught terminal cancellation')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});

it("bounds recursive parent discovery through the interpreter call stack", () => {
  const session = new PythonSession({limits: {maxSteps: 5000000, maxAllocatedBytes: 16000000, maxDepth: 60}, hashSeed: [1n, 2n]});
  expect(session.exec(`
try:
    __import__('encodings.' + 'child.' * 5000 + 'ascii')
except RecursionError:
    pass
else:
    raise AssertionError('unbounded package discovery')
`).status).toBe("ok");
  expect(session.eval("1").status).toBe("ok");
});
