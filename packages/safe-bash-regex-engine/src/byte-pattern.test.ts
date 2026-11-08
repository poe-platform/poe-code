import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { BytePattern } from "./text/regex.js";

const bytes = (text: string) => Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join("");
const budget = (env: Record<string, string> = {}) => new Budget({ env, signal: new AbortController().signal } as CommandContext, {});
for (const dialect of ["sed", "awk"] as const) {
  for (const [source, text, expected] of [
    ["a.b", "a😀b", "a😀b"],
    ["a[^x]b", "a😀b", "a😀b"],
    ["a.{2,}b", "a😀b", undefined],
    ["a..+b", "a😀b", undefined],
    ["[😀]+", "x😀😀y", "😀😀"],
    ["^a([^x]+)x", "a😀😁x", "a😀😁x"],
  ] as const) test(`byte regex ${dialect}: ${source}`, async () => {
    const pattern = new BytePattern(bytes(source), true, false, dialect);
    const limits = budget();
    await pattern.prepare(limits);
    const match = await pattern.tryFindSync(bytes(text), limits);
    assert.equal(match?.groups[0], expected === undefined ? undefined : bytes(expected));
    if (match) assert.equal(bytes(text).slice(match.start, match.end), bytes(expected!));
    assert.equal((await pattern.find(bytes(text), limits))?.groups[0], match?.groups[0]);
    if (pattern.canFindSync()) {
      const offsets = new Int32Array((pattern.groupCount + 1) * 2);
      assert.equal(pattern.findSyncFastInto(bytes(text), limits, 0, offsets), expected !== undefined);
      if (match) assert.deepEqual([...offsets.slice(0, 2)], [match.start, match.end]);
    }
  });
}

test("byte regex locale precedence and reused patterns preserve explicit byte mode", async () => {
  const pattern = new BytePattern("a.b");
  for (const [env, matches] of [
    [{}, true], [{LANG:"en_US.UTF-8"}, true], [{LC_ALL:"C",LANG:"en_US.UTF-8"}, false],
    [{LC_CTYPE:"POSIX",LANG:"en_US.UTF-8"}, false], [{LC_ALL:"C.UTF-8",LC_CTYPE:"C"}, true],
  ] as const) assert.equal(Boolean(await pattern.tryFindSync(bytes("a😀b"), budget(env))), matches);
});

test("Unicode byte captures and nonzero cursors preserve original byte positions", async () => {
  const pattern = new BytePattern(bytes("(😀+)"));
  const match = await pattern.find(bytes("😀x😀😀"), budget(), 4);
  assert.deepEqual(match && [match.start,match.end,...match.groups], [5,13,bytes("😀😀"),bytes("😀😀")]);
});

test("bounded UTF-8 batch matching allocates only the active record", async () => {
  const pattern = new BytePattern("^a(.)b$");
  const limits = new Budget({env:{},signal:new AbortController().signal} as CommandContext, {maxBufferBytes:128});
  await pattern.prepare(limits);
  const input = bytes("😀".repeat(100) + "a😁b" + "😀".repeat(100));
  const offsets = new Int32Array(4);
  assert.ok(pattern.canFindSync());
  assert.ok(pattern.findSyncFastInto(input, limits, 400, offsets, 406, 400));
  assert.deepEqual([...offsets], [400,406,401,405]);
});

test("UTF-8 decoding preserves malformed bytes and checks every caller's budget", async () => {
  const pattern = new BytePattern("a(.)b");
  const limits = budget();
  assert.equal((await pattern.find("a\xffb", limits))?.groups[1], "\xff");
  await pattern.find(bytes("a😀b"), limits);
  limits.maxBufferBytes = 8;
  await assert.rejects(pattern.find(bytes("a😀b"), limits), /buffer limit/);
});
