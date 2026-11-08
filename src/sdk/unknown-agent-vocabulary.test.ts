import { describe, it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../utils/file-system.js";
import { createCliContainer } from "../cli/container.js";
import { spawnCore } from "./spawn-core.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createContainer() {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  vol.mkdirSync(cwd, { recursive: true });
  const fs = createFsFromVolume(vol).promises as unknown as FileSystem;
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir, variables: {} },
    logger: () => {}
  });
}

/**
 * `gaslight --agent notreal` surfaced spawn-core's internal "service" noun.
 * The spawn path must use the same agent-worded message as the CLI commands.
 */
describe("spawnCore unknown agent vocabulary", () => {
  it("says agent, not service, and lists the spawnable agents", async () => {
    const error = await spawnCore(createContainer(), "notreal", { mode: "read" }).catch(
      (caught: Error) => caught
    );

    expect(error.message).not.toContain("service");
    expect(error.message).toContain('Unknown agent "notreal".');
    expect(error.message).toContain("Agents supporting spawn:");
  });

  it("reports a non-spawnable agent as lacking spawn rather than unknown", async () => {
    const error = await spawnCore(createContainer(), "poe-agent", { mode: "read" }).catch(
      (caught: Error) => caught
    );

    expect(error.message).toContain('Agent "poe-agent" does not support spawn.');
    expect(error.message).toContain("poe-agent supports: configure.");
  });
});
