import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCliEnvironment } from "../cli/environment.js";
import type { CommandContext } from "../cli/context.js";
import { createServiceManifest, ensureDirectory } from "./service-manifest.js";
import type { FileSystem } from "../utils/file-system.js";
import { type CommandRunner } from "../utils/command-checks.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync("/home/test", { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createStubCommand(fs: FileSystem): CommandContext {
  const runner: CommandRunner = async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0
  });

  return {
    fs,
    runCommand: runner,
    flushDryRun: vi.fn(),
    complete: vi.fn()
  };
}

describe("service manifest", () => {
  it("flushes dry run output after each mutation", async () => {
    const fs = createMemFs();
    const env = createCliEnvironment({ cwd: "/", homeDir: "/home/test" });
    const command = createStubCommand(fs);

    const manifest = createServiceManifest({
      id: "test",
      summary: "Test manifest",
      configure: [
        ensureDirectory({ path: "~/.test" }),
        ensureDirectory({ path: "~/.test-cache" })
      ]
    });

    await manifest.configure({
      fs,
      env,
      command,
      options: {}
    });

    expect(command.flushDryRun).toHaveBeenCalledTimes(2);
  });
});
