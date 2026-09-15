import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecReentrantRecoveryCases} from "./codec-reentrant-recovery-cases.js";
import reference from "./runtime/__snapshots__/codec-reentrant-recovery-3.14.7.json" with {type: "json"};

it.each(codecReentrantRecoveryCases)("reentrant codec recovery: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected).toMatchObject({source, status: 0, signal: null, stderr: ""});
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let detail: unknown = result;
  if (result.status === "exception") {
    session.globals.set("failure_result", result.exception);
    detail = session.eval("str(failure_result)");
  }
  expect(result.status, JSON.stringify(detail)).toBe("ok");
  expect(output).toBe(expected.stdout);
});

it.each(["ascii_encode", "latin_1_encode", "utf_8_encode", "charmap_encode", "ascii_decode", "utf_8_decode", "charmap_decode"].flatMap(operation =>
  [false, true].map(throws => ({operation, throws}))
))("cancellation inside a recursive $operation handler (throws=$throws)", ({operation, throws}) => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return "cancelled\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(String.raw`
import codecs
source = ${operation.endsWith("encode") ? "'\\ud800'" : "b'\\xff'"}
def run():
    return codecs.${operation}(source, 'recursive_cancel'${operation === "charmap_decode" ? ", {}" : ""})
def inner(error):
    input()
    ${throws ? "raise ValueError('nested failure')" : "return ('?', error.end)"}
class Position:
    def __index__(self):
        codecs.register_error('recursive_cancel', inner)
        run()
        print('index resumed')
        return 1
def outer(error):
    return ('?', Position())
codecs.register_error('recursive_cancel', outer)
try:
    run()
except BaseException:
    print('guest caught cancellation')
print('outer resumed')
`);
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("assert False")).toMatchObject({status: "terminated", reason: "cancelled"});
});
