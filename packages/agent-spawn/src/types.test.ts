import { describe, it, expect } from "vitest";
import { DEFAULT_SPAWN_MODE, resolveAgentModeConfig, type SpawnModesConfig } from "./types.js";

const modes: SpawnModesConfig = {
  yolo: ["--dangerously-skip-permissions"],
  auto: ["--auto"],
  edit: ["--allow-edits"],
  read: ["--read-only"]
};

const config = { agentId: "test-agent", modes };

describe("DEFAULT_SPAWN_MODE", () => {
  it("uses auto for every omitted spawn mode", () => {
    expect(DEFAULT_SPAWN_MODE).toBe("auto");
  });
});

describe("resolveAgentModeConfig", () => {
  it("resolves an omitted mode through the central auto default", () => {
    expect(resolveAgentModeConfig(config, undefined)).toEqual({
      args: modes.auto,
      env: undefined
    });
  });

  it("still honours an explicitly requested yolo mode", () => {
    expect(resolveAgentModeConfig(config, "yolo")).toEqual({
      args: modes.yolo,
      env: undefined
    });
  });
});
