import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {punycodeModuleCases} from "./punycode-module-cases.js";

it.each(punycodeModuleCases)("Punycode library: $name", ({source, name}) => {
  let reads = 0, output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    input: {readLine() { reads++; return "punycode\n"; }},
    output: {write(text) { output += text; }, flush() {}}
  });
  const result = session.exec(source);
  let detail: unknown = result.status;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    detail = session.eval("str(failure)");
  }
  expect(result.status, JSON.stringify(detail)).toBe("ok");
  expect(reads).toBe(name.startsWith("stream") ? 1 : name.startsWith("integer decoding") ? 2 : 0);
  expect(output).toBe(name.startsWith("stream") || name.startsWith("integer decoding") ? "verified\n" : "");
});

it("cancels Punycode integer decoding while guest indexing reads the input service", () => {
  const controller = new AbortController();
  let reads = 0, writes = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "punycode\n"; }},
    output: {write() { writes++; }, flush() {}}
  });
  expect(session.exec(`
import encodings.punycode as p
class Digits:
    def __getitem__(self, index):
        input()
        print('continued')
        return 65
try:
    p.decode_generalized_number(Digits(), 0, 72, 'strict')
except BaseException:
    print('recovered')
`)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
