import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../../../../src/utils/file-system.js";
import { ralphPlan } from "../index.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("ralphPlan", () => {
  it("defaults output to .agents/poe-code-ralph/plans/plan-<slug>.yaml", async () => {
    const cwd = "/repo";
    const fs = createMemFs();

    const result = await ralphPlan({
      request: "Build: a todo app!",
      cwd,
      deps: {
        fs,
        spawn: async (_agent, _options) => {
          await fs.mkdir("/repo/.agents/poe-code-ralph/plans", { recursive: true });
          await fs.writeFile(
            "/repo/.agents/poe-code-ralph/plans/plan-build-a-todo-app.yaml",
            "version: 1\nstories: []\n",
            { encoding: "utf8" }
          );
          return { exitCode: 0 };
        }
      }
    });

    expect(result.outPath).toBe(".agents/poe-code-ralph/plans/plan-build-a-todo-app.yaml");
    expect(
      await fs.readFile("/repo/.agents/poe-code-ralph/plans/plan-build-a-todo-app.yaml", "utf8")
    ).toContain("version: 1");
  });

  it("respects explicit outPath", async () => {
    const cwd = "/repo";
    const fs = createMemFs();

    const result = await ralphPlan({
      request: "Build a todo app",
      outPath: "custom/plan.yaml",
      cwd,
      deps: {
        fs,
        spawn: async (_agent, _options) => {
          await fs.mkdir("/repo/custom", { recursive: true });
          await fs.writeFile("/repo/custom/plan.yaml", "version: 1\nstories: []\n", {
            encoding: "utf8"
          });
          return { exitCode: 0 };
        }
      }
    });

    expect(result.outPath).toBe("custom/plan.yaml");
  });

  it("throws when the agent exits non-zero", async () => {
    const cwd = "/repo";
    const fs = createMemFs();

    await expect(
      ralphPlan({
        request: "Build a todo app",
        cwd,
        deps: {
          fs,
          spawn: async () => ({ exitCode: 2 })
        }
      })
    ).rejects.toThrow(/exit code/i);
  });

  it("throws when the agent does not write the output file", async () => {
    const cwd = "/repo";
    const fs = createMemFs();

    await expect(
      ralphPlan({
        request: "Build a todo app",
        cwd,
        deps: {
          fs,
          spawn: async () => ({ exitCode: 0 })
        }
      })
    ).rejects.toThrow(/write/i);
  });
});
