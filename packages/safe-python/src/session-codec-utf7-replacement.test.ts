import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecUtf7ReplacementCases} from "./codec-utf7-replacement-cases.js";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(codecUtf7ReplacementCases)("UTF-7 replacement input: $name", ({source}) => {
  const session = new PythonSession({limits, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it("cancels during the second UTF-7 fault after input replacement", () => {
  const controller = new AbortController();
  let reads = 0;
  const output: string[] = [];
  const session = new PythonSession({limits, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() { reads++; controller.abort(); return "continue\n"; }},
    output: {write(text) { output.push(text); }, flush() {}}
  });
  const result = session.exec(String.raw`
import codecs
seen = []
def handler(error):
    seen.append(error)
    if len(seen) == 1:
        error.object = b'+A'
        return ('?', 0)
    assert seen[0] is error
    input()
    print('resumed')
    return ('!', len(error.object))
codecs.register_error('utf7_cancel', handler)
codecs.utf_7_decode(b'\xff', 'utf7_cancel', True)
`);
  expect(reads).toBe(1);
  expect(output).toEqual([]);
  expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("print('after cancellation')")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(output).toEqual([]);
});
