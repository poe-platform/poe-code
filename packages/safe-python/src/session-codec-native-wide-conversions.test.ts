import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecNativeWideConversionCases} from "./codec-native-wide-conversion-cases.js";
import reference from "./runtime/__snapshots__/codec-native-wide-conversions-3.14.7.json" with {type: "json"};

it.each(codecNativeWideConversionCases)("native wide conversion: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected.source).toBe(source);
  expect(expected.status).toBe(0);
  let stdout = "";
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 32000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {stdout += text;}, flush() {}}});
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(stdout).toBe(expected.stdout);
});

it.each([16, 32])("keeps UTF-%s conversion cancellation terminal", width => {
  for (const operation of ["encode", "decode"]) {
    for (const stage of ["handler", "index"]) {
      for (const throws of [false, true]) {
        const controller = new AbortController(), writes: string[] = [];
        const session = new PythonSession({limits: {maxSteps: 300000, maxAllocatedBytes: 8000000, maxDepth: 100},
          hashSeed: [1n, 2n], signal: controller.signal,
          output: {write(text) {writes.push(text); controller.abort();}, flush() {}}});
        const cancel = `print('cancel')${throws ? "; raise ValueError('after cancellation')" : ""}`;
        const result = session.exec(`
import codecs
class Position:
    def __index__(self):
        ${stage === "index" ? cancel : "pass"}
        return -1
def handler(error):
    ${stage === "handler" ? cancel : "pass"}
    return ('?', Position())
codecs.register_error('wide_cancel', handler)
try:
    ${operation === "encode" ? "'\\ud800Z'" : "b'x'"}.${operation}('utf-${width}', 'wide_cancel')
except BaseException:
    print('recovered')
`);
        expect(writes).toEqual(["cancel"]);
        expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
        expect(session.exec("pass")).toMatchObject({status: "terminated", reason: "cancelled"});
      }
    }
  }
});
