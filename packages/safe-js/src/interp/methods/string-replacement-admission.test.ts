import { describe, expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { callStringMethod } from "./string.js";

describe("literal replacement admission", () => {
  it("rejects guest expansion before native replaceAll", async () => {
    const original = String.prototype.replaceAll;
    const native = vi.spyOn(String.prototype, "replaceAll").mockImplementation(function (search, replacement) {
      if (search === "" && replacement === "z".repeat(200)) {
        throw new Error("native replaceAll reached before admission");
      }
      return original.call(this, search, replacement as string);
    });
    try {
      await expect(run('return "a".repeat(1000000).replaceAll("", "z".repeat(200))', {
        budget: new Budget({ stringLength: 1500000, dataSize: 4000000, maxSteps: 2000000 })
      })).rejects.toThrow("stringLength");
      expect(native).not.toHaveBeenCalledWith("", "z".repeat(200));
    } finally {
      native.mockRestore();
    }
  });

  it.each(["replace", "replaceAll"] as const)("pre-admits %s context tokens", (method) => {
    const native = vi.spyOn(String.prototype, method);
    try {
      expect(() => callStringMethod("abcabc", method, ["b", "$`$'"], new Budget({ stringLength: 6 }))).toThrow("stringLength");
      expect(native).not.toHaveBeenCalledWith("b", "$`$'");
    } finally {
      native.mockRestore();
    }
  });

  it("rejects projected data usage before native allocation", () => {
    const native = vi.spyOn(String.prototype, "replaceAll");
    try {
      expect(() => callStringMethod("aaaa", "replaceAll", ["", "xxxx"], new Budget({ dataSize: 10 }))).toThrow("dataSize");
      expect(native).not.toHaveBeenCalledWith("", "xxxx");
    } finally {
      native.mockRestore();
    }
  });

  it("checks the budget while counting matches and replacement tokens", () => {
    expect(() => callStringMethod("aaaa", "replaceAll", ["a", "x"], new Budget({ maxSteps: 2 }))).toThrow("steps");
    expect(() => callStringMethod("a", "replaceAll", ["", "xxxxx"], new Budget({ maxSteps: 2 }))).toThrow("steps");
  });

  it("releases the output reservation when the native call fails", () => {
    const budget = new Budget({ dataSize: 100 });
    const native = vi.spyOn(String.prototype, "replaceAll").mockImplementation(() => {
      throw new Error("native failure");
    });
    try {
      expect(() => callStringMethod("a", "replaceAll", ["a", "xxxx"], budget)).toThrow("native failure");
      expect(budget.currentDataSize).toBe(0);
    } finally {
      native.mockRestore();
    }
  });

  it.each(["replace", "replaceAll"] as const)("preserves %s substitutions at the exact limit", async (method) => {
    for (const input of ["", "aba", "😀a"]) {
      for (const search of ["", "a", "aba", "missing"]) {
        for (const replacement of ["", "x", "$$", "$&", "$`", "$'", "$$&$1$<x>$", "$`$&$'"]) {
          const expected = input[method](search, replacement);
          expect(await callStringMethod(input, method, [search, replacement], new Budget({ stringLength: expected.length }))).toBe(expected);
        }
      }
    }
  });
});
