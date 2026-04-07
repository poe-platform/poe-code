import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config";
import { discoverAllPlans } from "./discovery.js";
import type { DiscoveryFs } from "./types.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(files: Record<string, string>): DiscoveryFs {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as DiscoveryFs;
}

describe("discoverAllPlans", () => {
  it("aggregates plans from pipeline, Ralph, and experiment sources sorted by updatedAt desc", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/pipeline/plans/plan-a.yaml": [
        "tasks:",
        "  - id: first",
        "    title: First",
        "    prompt: First prompt",
        "    status: done",
        "  - id: second",
        "    title: Second",
        "    prompt: Second prompt",
        "    status: open",
        ""
      ].join("\n"),
      "/repo/.poe-code/ralph/plans/spawn-hooks.md": [
        "---",
        "agent: claude-code",
        "iterations: 3",
        "status:",
        "  state: in_progress",
        "  iteration: 2",
        "---",
        "# Spawn hooks"
      ].join("\n"),
      "/repo/.poe-code/experiments/speed-up-tests.md": [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: test_duration",
        "  script: npm run metric:test_duration",
        "  direction: minimize",
        "baseline: null",
        "---",
        "# Speed up tests"
      ].join("\n"),
      "/repo/.poe-code/experiments/speed-up-tests.journal.jsonl": JSON.stringify({ status: "keep" })
    });

    const now = Date.UTC(2026, 3, 7, 12, 0, 0);
    await fs.utimes?.("/repo/.poe-code/pipeline/plans/plan-a.yaml", now / 1000 - 20, now / 1000 - 20);
    await fs.utimes?.("/repo/.poe-code/ralph/plans/spawn-hooks.md", now / 1000 - 10, now / 1000 - 10);
    await fs.utimes?.("/repo/.poe-code/experiments/speed-up-tests.md", now / 1000, now / 1000);

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd)
    });

    expect(plans.map((plan) => ({
      path: plan.path,
      source: plan.source,
      status: plan.status
    }))).toEqual([
      {
        path: ".poe-code/experiments/speed-up-tests.md",
        source: "experiment",
        status: "claude-code · minimize · keep"
      },
      {
        path: ".poe-code/ralph/plans/spawn-hooks.md",
        source: "ralph",
        status: "claude-code · ×3 · in_progress 2"
      },
      {
        path: ".poe-code/pipeline/plans/plan-a.yaml",
        source: "pipeline",
        status: "1/2 done"
      }
    ]);
  });

  it("deduplicates by absolute path and supports source filters", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/config.json": JSON.stringify({
        pipeline: {
          plan_directory: ".poe-code/shared-plans"
        },
        ralph: {
          plan_directory: ".poe-code/shared-plans"
        }
      }),
      "/repo/.poe-code/shared-plans/plan-shared.md": "# Shared Ralph",
      "/repo/.poe-code/shared-plans/plan-shared.yaml": [
        "tasks:",
        "  - id: first",
        "    title: First",
        "    prompt: First prompt",
        "    status: open",
        ""
      ].join("\n")
    });

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      source: "pipeline"
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]?.source).toBe("pipeline");
    expect(plans[0]?.path).toBe(".poe-code/shared-plans/plan-shared.yaml");
  });

  it("discovers experiment docs from the global home directory by default", async () => {
    const fs = createMemFs({
      "/home/test/.poe-code/experiments/global-exp.md": [
        "---",
        "agent: claude-code",
        "metric:",
        "  name: size",
        "  script: npm run metric:test_count",
        "  direction: minimize",
        "baseline: null",
        "---",
        "# Global experiment"
      ].join("\n")
    });

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      source: "experiment"
    });

    expect(plans).toEqual([
      expect.objectContaining({
        path: "~/.poe-code/experiments/global-exp.md",
        source: "experiment",
        status: "claude-code · minimize · open"
      })
    ]);
  });

  it("respects environment variable directory overrides", async () => {
    const fs = createMemFs({
      "/repo/custom-experiments/exp.md": [
        "---",
        "agent: codex",
        "metric:",
        "  name: size",
        "  script: npm run metric:test_count",
        "  direction: stable",
        "baseline: null",
        "---",
        "# Custom"
      ].join("\n")
    });

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      source: "experiment",
      variables: {
        POE_EXPERIMENT_PLAN_DIRECTORY: "custom-experiments"
      }
    });

    expect(plans).toEqual([
      expect.objectContaining({
        path: "custom-experiments/exp.md",
        source: "experiment",
        status: "codex · stable · open"
      })
    ]);
  });
});
