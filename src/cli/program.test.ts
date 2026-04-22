import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import { createProgram } from "./program.js";

function createMemFs(homeDir: string): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("createProgram", () => {
  const homeDir = "/home/test";

  it("registers the provider command group", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const providerCommand = program.commands.find((c) => c.name() === "provider");
    expect(providerCommand).toBeDefined();
  });

  it("registers login command", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const loginCommand = program.commands.find((c) => c.name() === "login");
    expect(loginCommand).toBeDefined();
  });

  it("registers configure command", () => {
    const fs = createMemFs(homeDir);
    const program = createProgram({
      fs,
      prompts: async () => ({}),
      env: { cwd: "/repo", homeDir },
      logger: () => {},
      exitOverride: true,
      suppressCommanderOutput: true
    });

    const configureCommand = program.commands.find((c) => c.name() === "configure");
    expect(configureCommand).toBeDefined();
  });
});
