import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { admitLimits, MdqBudget, type LimitOptions } from "./budget.js";
import { inline, node } from "./document.js";
import { parseMdqArguments } from "./options.js";
import { render } from "./render.js";

function budget(limits: LimitOptions): MdqBudget {
  return new MdqBudget({ command: "mdq", args: [], cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(new Uint8Array()), stdout: { async write() {} }, stderr: { async write() {} }
  }, admitLimits(limits));
}

test("table padding is admitted during rendering before allocating expanded rows", async () => {
  const table = node("table", { rows: [[[inline("text", "a".repeat(100))]], ...Array.from({ length: 20 }, () => [[inline("text", "x")]])], alignments: ["none"] });
  await assert.rejects(async () => render({ roots: [table], footnotes: new Map() }, [table], parseMdqArguments([]), budget({ outputBytes: 150 })), /outputBytes limit/);
});

test("JSON escaping reserves expanded bytes before serialization", async () => {
  const paragraph = node("paragraph", { inline: [inline("text", "\u0001".repeat(40))] });
  await assert.rejects(async () => render({ roots: [paragraph], footnotes: new Map() }, [paragraph], parseMdqArguments(["-o", "json"]), budget({ outputBytes: 150 })), /outputBytes limit/);
});

test("rendering budgets count UTF-8 and preserve an exactly fitting result", async () => {
  const paragraph = node("paragraph", { inline: [inline("text", "é")] });
  const output = await render({ roots: [paragraph], footnotes: new Map() }, [paragraph], parseMdqArguments([]), budget({ outputBytes: 3 }));
  assert.equal(output, "é\n");
  await assert.rejects(async () => render({ roots: [paragraph], footnotes: new Map() }, [paragraph], parseMdqArguments([]), budget({ outputBytes: 2 })), /outputBytes limit/);
});
