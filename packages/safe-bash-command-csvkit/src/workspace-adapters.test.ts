import { expect, it } from "vitest";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
import { createCsvkitCommands } from "./index.js";

it("registers standalone csvkit executors without bypassing custom options", () => {
  expect(createCsvkitCommands().every(command => builtInDirectContextExecutors.has(command.execute))).toBe(true);
  expect(createCsvkitCommands({ limits: { maxInputBytes: 1 } }).every(command => !builtInDirectContextExecutors.has(command.execute))).toBe(true);
  expect(syncCommandEvaluators.evalSyncCsvlook).toBeTypeOf("function");
});
