import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolvePlanPath } from "./discovery.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

describe("resolvePlanPath", () => {
  it("returns the explicit --plan path without discovery", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/custom.yaml": "tasks: []\n"
      }),
      plan: "custom.yaml"
    });

    expect(result).toBe("custom.yaml");
  });

  it("uses config planPath when present", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/config.yaml": "planPath: local-plan.yaml\n",
        "/repo/local-plan.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe("local-plan.yaml");
  });

  it("prompts for selection even with a single discovered plan", async () => {
    const select = vi.fn().mockResolvedValue(".poe-code/pipeline/plans/plan-demo.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-demo.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".poe-code/pipeline/plans/plan-demo.yaml (0/0)", value: ".poe-code/pipeline/plans/plan-demo.yaml" }
        ]
      })
    );
    expect(result).toBe(".poe-code/pipeline/plans/plan-demo.yaml");
  });

  it("returns null with a single plan when no selectPlan callback is provided", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-demo.yaml": "tasks: []\n"
      })
    });

    expect(result).toBeNull();
  });

  it("auto-selects the only discovered plan with --yes", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-demo.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe(".poe-code/pipeline/plans/plan-demo.yaml");
  });

  it("selects the first plan alphabetically with --yes", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-beta.yaml": "tasks: []\n",
        "/repo/.poe-code/pipeline/plans/plan-alpha.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe(".poe-code/pipeline/plans/plan-alpha.yaml");
  });

  it("prompts when multiple plans exist", async () => {
    const select = vi.fn().mockResolvedValue(".poe-code/pipeline/plans/plan-beta.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-beta.yaml": [
          "tasks:",
          "  - id: one",
          "    title: One",
          "    prompt: One",
          "    status: open",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/plans/plan-alpha.yaml": [
          "tasks:",
          "  - id: one",
          "    title: One",
          "    prompt: One",
          "    status: done",
          "  - id: two",
          "    title: Two",
          "    prompt: Two",
          "    status: open",
          ""
        ].join("\n")
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".poe-code/pipeline/plans/plan-alpha.yaml (1/2)", value: ".poe-code/pipeline/plans/plan-alpha.yaml" },
          { label: ".poe-code/pipeline/plans/plan-beta.yaml (0/1)", value: ".poe-code/pipeline/plans/plan-beta.yaml" }
        ]
      })
    );
    expect(result).toBe(".poe-code/pipeline/plans/plan-beta.yaml");
  });

  it("returns null when no plans exist and interactive mode can prompt for a path", async () => {
    const promptForPath = vi.fn().mockResolvedValue("manual-plan.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs(),
      promptForPath
    });

    expect(promptForPath).toHaveBeenCalled();
    expect(result).toBe("manual-plan.yaml");
  });

  it("throws when no plans exist and --yes is set", async () => {
    await expect(
      resolvePlanPath({
        cwd: "/repo",
        homeDir: "/home/test",
        assumeYes: true,
        fs: createFs()
      })
    ).rejects.toThrow(/no plan found/i);
  });

  it("discovers plans from global ~/.poe-code/pipeline/plans/", async () => {
    const select = vi.fn().mockResolvedValue("~/.poe-code/pipeline/plans/plan-global.yaml");

    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/plans/plan-global.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: "~/.poe-code/pipeline/plans/plan-global.yaml (0/0)", value: "~/.poe-code/pipeline/plans/plan-global.yaml" }
        ]
      })
    );
    expect(result).toBe("~/.poe-code/pipeline/plans/plan-global.yaml");
  });

  it("merges project and global plans, project first", async () => {
    const select = vi.fn().mockResolvedValue(".poe-code/pipeline/plans/plan-local.yaml");

    await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/plans/plan-local.yaml": "tasks: []\n",
        "/home/test/.poe-code/pipeline/plans/plan-global.yaml": "tasks: []\n"
      }),
      selectPlan: select
    });

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { label: ".poe-code/pipeline/plans/plan-local.yaml (0/0)", value: ".poe-code/pipeline/plans/plan-local.yaml" },
          { label: "~/.poe-code/pipeline/plans/plan-global.yaml (0/0)", value: "~/.poe-code/pipeline/plans/plan-global.yaml" }
        ]
      })
    );
  });

  it("auto-selects from global plans with --yes when no project plans exist", async () => {
    const result = await resolvePlanPath({
      cwd: "/repo",
      homeDir: "/home/test",
      assumeYes: true,
      fs: createFs({
        "/home/test/.poe-code/pipeline/plans/plan-global.yaml": "tasks: []\n"
      })
    });

    expect(result).toBe("~/.poe-code/pipeline/plans/plan-global.yaml");
  });
});
