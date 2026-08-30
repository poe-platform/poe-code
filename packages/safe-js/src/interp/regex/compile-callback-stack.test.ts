import { describe, expect, it } from "vitest";
import { run } from "../../run.js";

describe("compile callback stack control", () => {
  it("preserves nested captured diagnostic frames for an extracted replacement callback", async () => {
    const result = await run(`
      function outer() {
        function inner() {
          const replace = "a".replace;
          const callback = () => new Error("marker").stack;
          return replace("a", callback);
        }
        return inner();
      }
      return await outer();
    `);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.returnValue).toBeTypeOf("string");
    expect(result.returnValue).toContain("Error: marker");
    expect(result.returnValue).toContain("outer");
    expect(result.returnValue).toContain("inner");
  });
});
