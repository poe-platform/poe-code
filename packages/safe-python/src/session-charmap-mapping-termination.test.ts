import {expect, it} from "vitest";
import {PythonSession} from "./index.js";

const paths = [
  {operation: "encode", source: "'A'", stop: 65, policy: "strict", keys: [65]},
  {operation: "encode", source: "'AB'", stop: 66, policy: "replace", keys: [65, 66]},
  {operation: "encode", source: "'A'", stop: 63, policy: "replace", keys: [65, 63]},
  {operation: "decode", source: "b'A'", stop: 65, policy: "strict", keys: [65]},
  {operation: "decode", source: "b'BA'", stop: 65, policy: "strict", keys: [66, 65]},
] as const;

it.each(paths.flatMap(path => [false, true].map(throws => ({...path, throws}))))(
  "keeps guest $operation mapping cancellation terminal at $stop (throws=$throws)",
  ({operation, source, stop, policy, keys, throws}) => {
    const controller = new AbortController();
    let reads = 0, output = "";
    const session = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {reads++; controller.abort(); return "continue\n";}},
      output: {write(text) {output += text;}, flush() {}},
    });
    const result = session.exec(`
import codecs
class Mapping:
    def __getitem__(self, key):
        print(key)
        if key == ${stop}:
            input()
            ${throws ? "raise ValueError('after cancellation')" : "return 33"}
        return ${operation === "encode" ? "None" : "key"}
try:
    codecs.charmap_${operation}(${source}, '${policy}', Mapping())
except BaseException:
    print('guest caught cancellation')
print('codec resumed')
`);
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    expect(output).toBe(keys.map(key => `${key}\n`).join(""));
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
  },
);
