import { expect, it } from "vitest";
import { unrtfCommands as ownerPlugin } from "safe-bash-command-unrtf";
import { unrtfCommands } from "../packages/safe-bash/src/commands/unrtf/index.js";

it("preserves the canonical unrtf plugin identity at the public adapter", () => {
  expect(ownerPlugin().name).toBe("unrtf");
  expect(unrtfCommands().name).toBe("unrtf");
  expect(unrtfCommands({ replace: true }).name).toBe("unrtf");
});
