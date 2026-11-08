import { describe, it, expect, vi } from "vitest";

vi.mock("./configs/index.js", async () => {
  const actual = await vi.importActual<typeof import("./configs/index.js")>(
    "./configs/index.js"
  );
  return {
    ...actual,
    getSpawnConfig: () => undefined
  };
});

import { spawn } from "./spawn.js";

describe("spawn (missing config)", () => {
  it("throws error if agent has no spawn config", async () => {
    await expect(spawn("codex", { prompt: "hello" })).rejects.toThrow(
      'Agent "codex" has no spawn config.'
    );
  });
});

