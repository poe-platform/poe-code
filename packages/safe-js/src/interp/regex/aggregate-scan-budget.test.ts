import { describe, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";
import { matchRegex } from "./engine.js";
import { parseRegex } from "./parse.js";

describe("aggregate RegExp scan budget", () => {
  it("polls the caller deadline during a single scan", () => {
    const pattern = parseRegex("z");
    const budget = new Budget({ deadline: Date.now() - 1 });
    expect(() => matchRegex(pattern, "a".repeat(1000), 0, budget))
      .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "deadline" }));
  });

  it("charges successive candidate positions to the caller budget", () => {
    const pattern = parseRegex("z");
    const budget = new Budget({ maxSteps: 2000 });
    expect(matchRegex(pattern, "a".repeat(999), 0, budget)).toBeNull();
    expect(budget.stepsUsed).toBe(2000);
    expect(() => matchRegex(pattern, "z", 0, budget)).toThrow(SandboxError);
    expect(matchRegex(pattern, "a".repeat(1000) + "z", 0, new Budget({ maxSteps: 3000 })))
      .toMatchObject({ index: 1000, text: "z" });
  });

  it.each(["", "d", "g", "i", "m", "s", "u", "v"])(
    "bounds failed candidate scans with flag %s without native fallback", flags => {
      const pattern = parseRegex("z", flags);
      const native = vi.spyOn(globalThis, "RegExp").mockImplementation(() => {
        throw new Error("Unexpected native matching");
      });
      try {
        expect(() => matchRegex(pattern, "a".repeat(1000), 0, new Budget({ maxSteps: 2000 })))
          .toThrow(SandboxError);
        expect(native).not.toHaveBeenCalled();
      } finally {
        native.mockRestore();
      }
    }
  );

  it("counts Unicode positions and honors sticky and global starting positions", () => {
    const unicode = new Budget({ maxSteps: 2000 });
    expect(matchRegex(parseRegex("z", "u"), "😀".repeat(999), 0, unicode)).toBeNull();
    expect(unicode.stepsUsed).toBe(2000);
    const sticky = new Budget({ maxSteps: 2 });
    expect(matchRegex(parseRegex("z", "y"), "a".repeat(1000), 0, sticky)).toBeNull();
    expect(sticky.stepsUsed).toBe(2);
    expect(matchRegex(parseRegex("z", "g"), "a".repeat(1000) + "z", 1000, new Budget({ maxSteps: 2 })))
      .toMatchObject({ index: 1000, text: "z" });
  });

  it.each(["match", "matchAll", "replace", "replaceAll", "search", "split"])(
    "%s cannot catch or override aggregate rejection", async method => {
      const replacement = method.startsWith("replace") ? ", 'x'" : "";
      await expect(run(`try {
        const result = input.${method}(/a{0,30}z/g${replacement});
        return ${method === "matchAll" ? "Array.from(result)" : "result"};
      } catch (error) { return 'caught'; } finally { return 'overridden'; }`, {
        budget: new Budget({ maxSteps: 2000 }),
        bindings: { input: "a".repeat(1000) }
      })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps", limit: 2000 });
    }
  );
});
