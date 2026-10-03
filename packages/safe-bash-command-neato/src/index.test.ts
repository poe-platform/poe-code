import { expect, test } from "vitest";
import { createNeatoCommand, neatoCommands } from "./index.js";
test("validates resource settings before registration", () => {
  expect(() => createNeatoCommand({ limits: { maxInputBytes: -1 } })).toThrow();
});
test("refuses a duplicate without replacing it", () => {
  const plugin = neatoCommands();
  let registered = false;
  expect(() =>
    plugin.setup({
      commands: {
        has: () => true,
        register: () => {
          registered = true;
        }
      }
    } as never)
  ).toThrow("already registered");
  expect(registered).toBe(false);
});
