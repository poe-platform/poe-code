import { it, expect } from "vitest";
import { createSoxiCommand, createSoxiCommands, soxiCommands } from "./index.js";
it("owns the soxi registration and validates limits", () => {
  expect(createSoxiCommand().name).toBe("soxi");
  expect(createSoxiCommands()).toHaveLength(1);
  expect(soxiCommands().name).toBe("soxi-commands");
  expect(() => createSoxiCommand({ limits: { maxSamples: 0 } })).toThrow();
});
