import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";

const native = await compiledPublicRuntime;

it("compiled-native public package runtime is distinct from the source alias", () => {
  expect(native.Document).not.toBe(source.Document);
  expect(native.DocumentBudget).not.toBe(source.DocumentBudget);
});
