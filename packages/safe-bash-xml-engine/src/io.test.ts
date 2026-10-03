import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { readXmlInput, type XmlCommandRuntime } from "./io.js";
import { XmlBudget, resolveXmlQueryLimits } from "./limits.js";

const runtime: XmlCommandRuntime = {
  yieldTurn: async () => {},
  pathOf: (_context, path) => path,
  interruptible: async operation => operation(),
  writeDiagnostic: async () => {}
};

for (const input of ["stdin", "stream", "file"] as const) {
  for (const maximum of [6, 7]) {
    test(`XML ${input} honors host byte ceiling ${maximum}`, async () => {
      const failure = new Error("host input limit");
      const totals: number[] = [];
      const context = {
        signal: new AbortController().signal,
        stdin: toByteSource("<root/>"),
        fs: {
          capabilities: { streamingRead: input === "stream", retainedRead: true },
          readStream: () => toByteSource("<root/>"),
          readFile: async () => { throw new Error("whole-file read"); },
          openReadFile: async () => ({
            read: async (position: number, maximum: number) => new TextEncoder().encode("<root/>").subarray(position, position + maximum),
            close: async () => {}
          })
        },
        inputBudget: {
          maxBytes: maximum,
          check(total: number) {
            totals.push(total);
            if (total > maximum) throw failure;
          }
        }
      } as unknown as CommandContext;
      const budget = new XmlBudget(resolveXmlQueryLimits(), context.signal, runtime.yieldTurn);
      const result = readXmlInput(context, input === "stdin" ? undefined : "/input.xml", budget, runtime);
      if (maximum === 6) await assert.rejects(result, error => error === failure);
      else assert.equal(await result, "<root/>");
      assert.deepEqual(totals, input === "file" && maximum === 6 ? [6, 7] : [7]);
    });
  }
}

test("XML charges cumulative UTF-8 chunks before requesting more input", async () => {
  const failure = new Error("host input limit");
  const totals: number[] = [];
  let closed = false;
  const context = {
    signal: new AbortController().signal,
    stdin: (async function* () {
      try {
        yield new TextEncoder().encode("<r>");
        yield new TextEncoder().encode("é");
        assert.fail("over-budget reader requested another chunk");
      } finally { closed = true; }
    })(),
    inputBudget: { maxBytes: 4, check(total: number) {
      totals.push(total);
      if (total > 4) throw failure;
    } }
  } as unknown as CommandContext;
  const budget = new XmlBudget(resolveXmlQueryLimits(), context.signal, runtime.yieldTurn);
  await assert.rejects(readXmlInput(context, undefined, budget, runtime), error => error === failure);
  assert.deepEqual(totals, [3, 5]);
  assert.equal(closed, true);
});

for (const [commandMaximum, hostMaximum, used, expected] of [
  [10, 20, 3, 7], [20, 10, 3, 7], [10, 3, 3, 0]
] as const) {
  test(`retained XML read caps remaining window at ${expected} (${commandMaximum}, ${hostMaximum}, ${used})`, async () => {
    const context = {
      signal: new AbortController().signal,
      fs: {
        capabilities: { streamingRead: false, retainedRead: true },
        readFile: async () => { throw new Error("whole-file read"); },
        openReadFile: async () => ({
          read: async (_position: number, maximum: number) => {
            assert.equal(maximum, Math.max(1, expected));
            return new Uint8Array();
          },
          close: async () => {}
        })
      },
      inputBudget: { maxBytes: hostMaximum, check() {} }
    } as unknown as CommandContext;
    const budget = new XmlBudget(resolveXmlQueryLimits({ maxInputBytes: commandMaximum }), context.signal, runtime.yieldTurn);
    budget.inputBytes = used;
    assert.equal(await readXmlInput(context, "/input.xml", budget, runtime), "");
  });
}
