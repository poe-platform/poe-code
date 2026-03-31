import { describe, it, expect, vi, afterEach } from "bun:test";
import * as resolveConfigModule from "./configs/resolve-config.js";
import { spawn } from "./spawn.js";

let resolveConfigSpy: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  resolveConfigSpy?.mockRestore();
});

describe("spawn (missing config)", () => {
  it("throws error if agent has no spawn config", async () => {
    resolveConfigSpy = vi.spyOn(resolveConfigModule, "resolveConfig").mockReturnValue({
      agentId: "codex",
      spawnConfig: undefined
    });
    await expect(spawn("codex", { prompt: "hello" })).rejects.toThrow(
      'Agent "codex" has no spawn config.'
    );
  });
});
