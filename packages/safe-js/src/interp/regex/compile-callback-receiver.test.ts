import { describe, expect, it } from "vitest";
import { run } from "../../run.js";

describe("compile callback receiver control", () => {
  it("preserves bound receivers for extracted replace and replaceAll callbacks", async () => {
    const result = await run(`
      const receiver = { value: "X", calls: 0 };
      function callback() {
        this.calls++;
        return this.value;
      }
      const bound = callback.bind(receiver);
      const replace = "a".replace;
      const replaceAll = "aa".replaceAll;
      const first = await replace.call("a", "a", bound);
      const second = await replaceAll.call("aa", "a", bound);
      return [first, second, receiver.calls];
    `);
    expect(result).toMatchObject({ ok: true, returnValue: ["X", "XX", 3] });
  });
});
