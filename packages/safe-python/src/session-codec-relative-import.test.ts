import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecRelativeImportCases} from "./codec-relative-import-cases.js";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(codecRelativeImportCases)("codec relative import: $name", row => {
  const warnings: {category: string; message: string}[] = [];
  const session = new PythonSession({limits, hashSeed: [1n, 2n], warning: warning => warnings.push(warning), input: {readLine: () => "encodings\n"}, output: {write() {}, flush() {}}});
  const {source} = row;
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("repr(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail ?? (result.status === "terminated" ? result.message : undefined)).toBe("ok");
  expect(warnings.map(({category, message}) => ({category, message}))).toEqual("warnings" in row ? row.warnings : []);
});

it("keeps cancellation during relative import metadata terminal", () => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({limits, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return "encodings\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(codecRelativeImportCases.at(-1)!.source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("parent\n");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});

it("reports package mismatch and fallback through the warning service", () => {
  const warnings: {category: string; message: string}[] = [];
  const session = new PythonSession({limits, hashSeed: [1n, 2n], warning: warning => warnings.push(warning)});
  expect(session.exec(`
import encodings.ascii as ascii
class Spec:
    parent = 'other'
assert __import__('ascii', {'__package__': 'encodings', '__spec__': Spec()}, level=1) is ascii
assert __import__('ascii', {'__name__': 'encodings.child'}, level=1) is ascii
`).status).toBe("ok");
  expect(warnings.map(({category, message}) => ({category, message}))).toEqual([
    {category: "DeprecationWarning", message: "__package__ != __spec__.parent"},
    {category: "ImportWarning", message: "can't resolve package from __spec__ or __package__, falling back on __name__ and __path__"}
  ]);
});
