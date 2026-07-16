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
  it("is the safe interactive default rather than yolo", () => {
    expect(DEFAULT_SPAWN_MODE).toBe("edit");
  });
});

describe("resolveAgentModeConfig", () => {
  it("falls back to the safe default mode when no mode is given", () => {
    expect(resolveAgentModeConfig(config, undefined)).toEqual({
      args: modes.edit,
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
