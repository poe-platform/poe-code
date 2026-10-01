import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { Budget } from "./text/budget.js";
import { Pattern } from "./text/regex.js";

for (const method of ["find", "tryFindSync", "tryTestSync", "findSyncFastInto"] as const) {
  for (const source of ["a+$", "aa+$", "a{4000,}", "aa{4000,}", "[😀]+$", "😀[😀]+$"]) {
    test(`${method} scans ${source} linearly`, async t => {
      const input = (source.includes("😀") ? "😀" : "a").repeat(200) + "b";
      const budget = new Budget({ signal: new AbortController().signal } as CommandContext, {});
      const pattern = new Pattern(source, true, false, "sed");
      await pattern.prepare(budget);
      assert.equal(pattern.canFindSync(), true);
      let reads = 0;
      const codePointAt = String.prototype.codePointAt;
      t.mock.method(String.prototype, "codePointAt", function (this: string, index: number) {
        if (String(this) === input) reads++;
        return codePointAt.call(this, index);
      });
      const result = method === "findSyncFastInto"
        ? pattern.findSyncFastInto(input, budget, 0, new Int32Array(4))
        : await pattern[method](input, budget);
      assert.equal(result, method === "findSyncFastInto" || method === "tryTestSync" ? false : undefined);
      assert.ok(reads <= input.length * 4, `${reads} character reads for ${input.length} code units`);
    });
  }
  for (const source of ["a+$", "aa+$", "^a+$"]) {
    for (const abort of [false, true]) {
      test(`${method} promptly enforces ${abort ? "abort" : "maxSteps"} for ${source}`, async t => {
        const input = "a".repeat(200) + "b";
        const controller = new AbortController();
        const budget = new Budget({ signal: controller.signal } as CommandContext, { maxSteps: 50 });
        const pattern = new Pattern(source, true, false, "sed");
        await pattern.prepare(budget);
        let reads = 0;
        const codePointAt = String.prototype.codePointAt;
        t.mock.method(String.prototype, "codePointAt", function (this: string, index: number) {
          if (String(this) === input && ++reads === 10 && abort) controller.abort(new Error("cancelled"));
          return codePointAt.call(this, index);
        });
        await assert.rejects(async () => {
          if (method === "findSyncFastInto") pattern.findSyncFastInto(input, budget, 0, new Int32Array(4));
          else await pattern[method](input, budget);
        }, abort ? /cancelled/ : /execution step limit exceeded/);
        assert.ok(reads <= 60, `scanned ${reads} characters before enforcing budget`);
      });
    }
  }
}

for (const source of ["a+$", "aa+$", "aa{3,}", "ab[a-b]+$", "😀[😀]{3,}$", "a([^x]{2,})$", "a(a*)$", "^a(a+)$"]) {
  test(`repeat watermark preserves matches and captures for ${source}`, async () => {
    const pattern = new Pattern(source, true, false, "sed");
    const budget = () => new Budget({ signal: new AbortController().signal } as CommandContext, {});
    await pattern.prepare(budget());
    assert.equal(pattern.canFindSync(), true);
    for (const input of ["", "a", "aaaa", "aaaabaaaaa", "abababb", "😀😀x😀😀😀😀", "a😀xaaa😀😀", "baaaa"]) {
      for (const from of [0, 1, input.length, input.length + 1]) {
        const native = new RegExp(source, "gu");
        native.lastIndex = from;
        const expected = native.exec(input);
        // Native Unicode RegExp rounds offsets inside a surrogate pair down;
        // the engine's explicit UTF-16 offset must be a character boundary.
        if (from === 1 && input.startsWith("😀")) continue;
        for (const method of ["find", "tryFindSync"] as const) {
          const actual = await pattern[method](input, budget(), from);
          assert.deepEqual(actual, expected ? {
            start: expected.index, end: expected.index + expected[0].length, groups: [...expected],
          } : undefined, `${method}: ${JSON.stringify(input)} at ${from}`);
        }
        const offsets = new Int32Array(4);
        assert.equal(pattern.findSyncFastInto(input, budget(), from, offsets), expected !== null);
        if (expected) assert.deepEqual([...offsets.slice(0, 2)], [expected.index, expected.index + expected[0].length]);
      }
      const offsets = new Int32Array(4);
      const expected = new RegExp(source, "u").exec(input);
      assert.equal(pattern.findSyncFastInto("!!" + input + "!!", budget(), 2, offsets, 2 + input.length, 2), expected !== null);
      if (expected) {
        assert.deepEqual([...offsets.slice(0, 2)], [2 + expected.index, 2 + expected.index + expected[0].length]);
        if (expected[1] !== undefined) assert.equal(("!!" + input + "!!").slice(offsets[2], offsets[3]), expected[1]);
      }
    }
  });
}
