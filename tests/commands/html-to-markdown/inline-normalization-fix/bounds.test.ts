import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "../../../../src/commands/html-to-markdown/budget.js";
import { settings } from "../../../../src/commands/html-to-markdown/options.js";
import { Parser } from "../../../../src/commands/html-to-markdown/parser.js";
import { Renderer } from "../../../../src/commands/html-to-markdown/render.js";
import { convert } from "../helpers.js";

const empties = "<b><span><em></em></span></b><a></a><code></code>";

for (const count of [256, 2048, 8192]) test(`long zero-output adjacency ${count}`, async () => {
  const result = await convert("<em>a</em>" + empties.repeat(count) + "<i>b</i>");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "*ab*\n");
});

test("nested empty styles and transparent wrappers preserve adjacency", async () => {
  const tags = ["b", "span", "unknown", "em", "a"];
  const open = Array.from({ length: 100 }, (_, index) => `<${tags[index % tags.length]}>`).join("");
  const close = Array.from({ length: 100 }, (_, index) => `</${tags[(99 - index) % tags.length]}>`).join("");
  const result = await convert("1" + open + close + ") ordinary");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "1\\) ordinary\n");
});

test("ragged style aliases coalesce without copying accumulated prefixes", async () => {
  const input = Array.from({ length: 4096 }, (_, index) => index % 2 ? "<span><i>b</i></span><code></code>" : "<em>a<b></b></em><a></a>").join("");
  const result = await convert(input);
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "*" + "ab".repeat(2048) + "*\n");
});

for (const [limit, maximum, input] of [
  ["maxWorkUnits", 4096, empties.repeat(2048)],
  ["maxDepth", 16, "<span>".repeat(17) + "</span>".repeat(17)],
  ["maxTokens", 32, empties.repeat(100)],
  ["maxNodes", 32, empties.repeat(100)],
  ["maxTokenBytes", 8, "<unknownwrapper></unknownwrapper>"],
  ["maxOutputBytes", 4, "<em>a</em><b></b><em>b</em>"],
] as const) test(`normalization keeps ${limit}`, async () => {
  const result = await convert(input, { limits: { [limit]: maximum } });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /EFBIG/u);
});

test("normalization charges empty visits before growth and scales linearly", async () => {
  const context = (await convert("")).context;
  const observations: number[] = [];
  for (const count of [512, 1024, 2048]) {
    const parser = new Parser(new Budget(context, settings({})));
    await parser.feed("<em>a</em>" + empties.repeat(count) + "<em>b</em>");
    const root = await parser.finish();
    const budget = new Budget(context, settings({}));
    let work = 0;
    const original = budget.work.bind(budget);
    budget.work = amount => { original(amount); work += amount; };
    assert.equal(await new Renderer(budget).document(root), "*ab*\n");
    observations.push(work);
    await assert.rejects(new Renderer(new Budget(context, settings({ limits: { maxWorkUnits: 64 } }))).document(root), { code: "EFBIG" });
  }
  assert(observations[1]! <= observations[0]! * 2.1);
  assert(observations[2]! <= observations[1]! * 2.1);
});

test("charged normalization yields in flight and preserves exact reason", async () => {
  const controller = new AbortController(), reason = Object.freeze({ normalization: true });
  const context = (await convert("")).context;
  const parser = new Parser(new Budget(context, settings({})));
  await parser.feed("<em>a</em>" + empties.repeat(8192) + "<i>b</i>");
  const root = await parser.finish(), budget = new Budget({ ...context, signal: controller.signal }, settings({}));
  const originalWork = budget.work.bind(budget), originalCheckpoint = budget.checkpoint.bind(budget);
  let work = 0, queued = false, triggered = false, settled = false;
  budget.work = amount => { originalWork(amount); work += amount; };
  budget.checkpoint = async () => {
    if (!queued && work >= 4096) {
      queued = true;
      setImmediate(() => { assert.equal(settled, false); triggered = true; controller.abort(reason); });
    }
    await originalCheckpoint();
  };
  try { await assert.rejects(new Renderer(budget).document(root), error => error === reason); }
  finally { settled = true; }
  assert.equal(triggered, true);
});

test("normalized large output awaits sink backpressure", async () => {
  let release: (() => void) | undefined, writes = 0, settled = false;
  let admitted: (() => void) | undefined;
  const admission = new Promise<void>(resolve => { admitted = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const output: Uint8Array[] = [];
  const pending = convert("<em>" + "ab".repeat(5000) + "</em><b></b><em>end</em>", {}, {
    stdout: { async write(bytes) { writes++; output.push(new Uint8Array(bytes)); if (writes === 1) { admitted!(); await barrier; } } },
  }).finally(() => { settled = true; });
  await admission;
  try { assert.equal(writes, 1); assert.equal(settled, false); }
  finally { release!(); }
  const result = await pending;
  assert.equal(result.exitCode, 0); assert(writes > 1);
  assert.equal(Buffer.concat(output).toString(), "*" + "ab".repeat(5000) + "end*\n");
});

test("sink failure preserves only the accepted prefix", async () => {
  const output: Uint8Array[] = [];
  let writes = 0;
  const result = await convert("<em>" + "ab".repeat(5000) + "</em><b></b><em>end</em>", {}, {
    stdout: { async write(bytes) { if (++writes === 2) throw new Error("inline sink failure"); output.push(new Uint8Array(bytes)); } },
  });
  assert.equal(result.exitCode, 1); assert.match(result.stderr, /inline sink failure/u);
  assert.equal(Buffer.concat(output).toString(), ("*" + "ab".repeat(5000) + "end*\n").slice(0, 4096));
});
