import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {coreCodecBufferCases} from "./core-codec-buffer-cases.js";

it.each(coreCodecBufferCases)("public codec buffer contract: $name", ({source}) => {
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

it.each(["ascii", "latin_1", "utf_8"].flatMap(codec => [false, true].map(throws => ({codec, throws}))))(
  "keeps cancellation in $codec buffer acquisition fatal (throws=$throws)", ({codec, throws}) => {
    const controller = new AbortController(), writes: string[] = [];
    const session = new PythonSession({limits: {maxSteps: 300000, maxAllocatedBytes: 8000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
      output: {write(text) {writes.push(text); controller.abort();}, flush() {}}
    });
    const result = session.exec(`
from _codecs import ${codec}_decode as decode
class Export(bytes):
    def __buffer__(self, flags):
        print('cancel')
        ${throws ? "raise ValueError('after cancellation')" : "return None"}
try:
    decode(Export(b'inherited'))
except BaseException:
    print('recovered')
`);
    expect(writes, `throws=${throws}`).toEqual(["cancel"]);
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
