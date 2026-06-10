import { describe, expect, it } from "vitest";
import * as core from "./core.js";

import { Budget } from "./interp/budget.js";
import { lint } from "./lint.js";
import { run } from "./run.js";

describe("@poe-code/agent-script/core", () => {
  it("exports the lightweight interpreter surface without agent spawning", () => {
    expect(core.Budget).toBe(Budget);
    expect(core.lint).toBe(lint);
    expect(core.run).toBe(run);
    expect(Object.keys(core).sort()).toEqual(["Budget", "run", "lint"].sort());
  });
});
