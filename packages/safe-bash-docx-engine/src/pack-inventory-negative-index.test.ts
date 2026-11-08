import { describe, expect, it } from "vitest";
import { InputTypeError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import { admitPackageInventory } from "./pack-inventory.js";

function inventory() {
  return {
    version: 1,
    kind: "docx",
    dialect: "transitional",
    entries: [{
      part: "[Content_Types].xml",
      path: "[Content_Types].xml",
      contentType: "application/xml",
      bytes: 0,
      sha256: "0".repeat(64)
    }],
    directories: ["empty"]
  };
}

describe("closed package inventory arrays", () => {
  it("admits ordinary own-data entry and directory arrays", () => {
    const input = inventory();
    expect(admitPackageInventory(input, new DocumentBudget(), false)).toEqual(input);
  });

  it.each(["entries", "directories"] as const)("rejects a negative own data key on %s", field => {
    const input = inventory();
    Object.defineProperty(input[field], "-1", { value: input[field][0] });
    expect(() => admitPackageInventory(input, new DocumentBudget(), false)).toThrow(InputTypeError);
  });
});
