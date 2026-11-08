import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { isUserError } from "@poe-code/user-error";
import type { FileSystem } from "../utils/file-system.js";
import type { CommandRunner } from "../utils/command-checks.js";
import { createCliContainer } from "../cli/container.js";
import { spawnCore } from "./spawn-core.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createContainer(commandRunner?: CommandRunner) {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  vol.mkdirSync(`${homeDir}/.poe-code/opencode/.config/opencode`, { recursive: true });
  vol.writeFileSync(`${homeDir}/.poe-code/opencode/.config/opencode/config.json`, "{}");
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir, variables: {} },
    ...(commandRunner ? { commandRunner } : {}),
    logger: () => {}
  });
}

/**
 * An unusable --resume-thread-id used to reach the agent CLI, which answered in
 * its own vocabulary about UUIDs and session titles - a flag the user never typed.
 */
describe("spawnCore resume thread id validation", () => {
  it.each([
    ["a blank id", "   "],
    ["an id containing spaces", "not a real id"],
    ["a flag-shaped id", "--resume"],
    ["an id containing a newline", "thread\nabc"],
    ["an id containing a tab", "thread\tabc"]
  ])("rejects %s before the agent runs", async (_label, resumeThreadId) => {
    const calls: string[] = [];
    const runner: CommandRunner = async (command) => {
      calls.push(command);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const error = await spawnCore(createContainer(runner), "opencode", {
      prompt: "hello",
      resumeThreadId
    })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(isUserError(error)).toBe(true);
    expect((error as Error).message).toContain("--resume-thread-id");
    expect(calls).toEqual([]);
  });

  it("passes a well-formed id through to the agent", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await spawnCore(createContainer(runner), "opencode", {
      prompt: "hello",
      resumeThreadId: "ses_abc-123"
    });

    expect(calls.length).toBeGreaterThan(0);
  });
});
