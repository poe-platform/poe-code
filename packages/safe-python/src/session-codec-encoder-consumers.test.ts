import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecEncoderConsumerCases} from "./codec-encoder-consumer-cases.js";

it.each(codecEncoderConsumerCases)("registered encoder consumer: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure_result", result.exception);
    const diagnostic = session.eval("str(failure_result)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it.each(["search", "encode"])("keeps cancellation fatal in custom encoder %s", stage => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "cancelled\n"; }}, output: {write() {}, flush() {}}
  });
  const result = session.exec(`
import _codecs
def encode(*args):
    ${stage === "encode" ? "input()" : "pass"}
    return (b'output', 0)
def search(name):
    ${stage === "search" ? "input()" : "pass"}
    return (encode, None, None, None)
_codecs.register(search)
try:
    'text'.encode('cancel-encoder')
except BaseException:
    raise AssertionError('continued after cancellation')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
