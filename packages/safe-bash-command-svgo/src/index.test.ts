import { expect, test } from "vitest";
import { createSvgoCommand, svgoCommands } from "./index.js";
test("validates resource settings before registration", () => {
  expect(() => createSvgoCommand({ limits: { maxInputBytes: -1 } })).toThrow();
});
test("refuses a duplicate without replacing it", () => {
  const plugin = svgoCommands();
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
