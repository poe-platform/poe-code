import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecRecoveryIndexBoundaryCases} from "./codec-recovery-index-boundary-cases.js";
import reference from "./runtime/__snapshots__/codec-recovery-index-boundaries-3.14.7.json" with {type: "json"};

it.each(codecRecoveryIndexBoundaryCases)("recovery index boundaries: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected.source).toBe(source);
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(expected.stdout);
});

it.each(["ascii_encode", "latin_1_encode", "utf_8_encode", "ascii_decode", "utf_8_decode"].flatMap(operation =>
  [false, true].map(throws => ({operation, throws}))
))("cancellation during $operation index conversion (throws=$throws)", ({operation, throws}) => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    signal: controller.signal,
    input: {readLine() {reads++; controller.abort(); return "cancelled\n";}},
    output: {write() {}, flush() {}}
  });
  const result = session.exec(String.raw`
import codecs
class Position:
    def __index__(self):
        input()
        ${throws ? "raise ValueError('index failed')" : "return -1"}
def handler(error):
    return ('?', Position())
codecs.register_error('cancel_index', handler)
try:
    codecs.${operation}(${operation.endsWith("encode") ? "'A\\ud800Z'" : "b'A\\xffZ'"}, 'cancel_index')
except BaseException:
    raise AssertionError('cancellation reached guest')
`);
  expect(reads).toBe(1);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("assert False")).toMatchObject({status: "terminated", reason: "cancelled"});
});
