import { expect, it } from "vitest";
import { run } from "../../run.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "../object-model.js";

for (const expression of ["new Map()", "new Set()", "{}", "[]", "/x/", "Object.create(null)"]) {
  for (const operation of ["freeze", "seal", "preventExtensions"]) {
    it(`allows the existing prototype of ${operation}(${expression})`, async () => {
      const source = `const value=${expression};const prototype=Object.getPrototypeOf(value);
        Object.${operation}(value);return Object.setPrototypeOf(value,prototype)===value`;
      expect((await run(source)).returnValue).toBe(true);
    });

    it(`rejects a different prototype of ${operation}(${expression})`, async () => {
      const source = `const value=${expression};Object.${operation}(value);
        try { Object.setPrototypeOf(value, {}); return false; }
        catch (error) { return error instanceof TypeError; }`;
      expect((await run(source)).returnValue).toBe(true);
    });
  }
}

it("retains explicit null metadata without a runtime budget", () => {
  const value = Object.freeze(Object.create(null));
  setSandboxPrototype(value, null);
  expect(hasNullObjectPrototype(value)).toBe(true);
});
