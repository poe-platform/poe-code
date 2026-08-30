import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";

describe("compile guard RED", () => {
  it("accepts a regex literal at the supplied pattern length limit", async () => {
    await expect(
      run("return /abc/.source", {
        budget: new Budget({ stringLength: 3 })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "abc"
    });
  });

  it.each([
    ["evaluated", "return /abcd/"],
    ["unevaluated", "if (false) { /abcd/; } return 1"]
  ])("refuses an over-limit %s literal before VM execution", async (_name, source) => {
    const result = run(source, {
      budget: new Budget({ stringLength: 3 })
    });

    await expect(result).rejects.toBeInstanceOf(SandboxError);
    await expect(result).rejects.toMatchObject({
      name: "SandboxError",
      code: "budgetExceeded",
      budget: "stringLength",
      current: 4,
      limit: 3,
      message: "Sandbox budget exceeded for stringLength: 4 > 3."
    });
  });
});
