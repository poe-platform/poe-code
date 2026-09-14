import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecParentPublicationCases} from "./codec-parent-publication-cases.js";
import reference from "./runtime/__snapshots__/codec-parent-publication-3.14.7.json";

it.each(codecParentPublicationCases)("codec parent publication: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected).toMatchObject({source, status: 0, stderr: ""});
  let output = "";
  const warnings: {category: string; message: string}[] = [];
  const session = new PythonSession({
    hashSeed: [1n, 2n], limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    warning: ({category, message}) => warnings.push({category, message}),
    input: {readLine: () => "continue\n"},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(output).toBe(expected.stdout);
  expect(warnings).toEqual(expected.warnings);
});

it.each([false, true])("keeps cancellation in a parent setter terminal (throw=%s)", throws => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n], signal: controller.signal,
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {
      reads++;
      controller.abort();
      if (throws) throw new Error("service failed");
      return "continue\n";
    }}, output: {write() {}, flush() {}}
  });
  const result = session.exec(`
import encodings
class Package(type(encodings)):
    def __setattr__(self, name, value):
        input()
        raise AssertionError('continued after cancellation')
encodings.__class__ = Package
try:
    import encodings.cp037
except BaseException:
    raise AssertionError('caught cancellation')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("import encodings.cp037")).toBe(result);
  expect(session.eval("1")).toBe(result);
  expect(reads).toBe(1);
});
