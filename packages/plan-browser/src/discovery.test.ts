import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("discoverAllPlans", () => {
  it("discovers only archived plans when archived mode is enabled", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/active.md": "# Active\n",
      "/repo/docs/plans/archive/archived.md": "# Archived\n",
      "/repo/docs/plans/archive/legacy.md":
        "---\nkind: archived-pipeline-plan\n---\n# Legacy pipeline\n",
      "/repo/docs/plans/archive/old-pipeline.md": "---\nkind: pipeline\n---\n# Old pipeline\n",
      "/repo/docs/plans/archive/historical.md": "---\nkind: task-store\n---\n# Historical\n"
    });

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      archived: true
    });

    expect(plans.map(({ path, kind }) => ({ path, kind }))).toEqual(
      expect.arrayContaining([
        { path: "docs/plans/archive/archived.md", kind: "plan" },
        { path: "docs/plans/archive/legacy.md", kind: "plan" },
        { path: "docs/plans/archive/old-pipeline.md", kind: "plan" },
        { path: "docs/plans/archive/historical.md", kind: "plan" }
      ])
    );
  });

  it("sorts ready plans before newer drafts and exposes readiness", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/draft.md": "---\nkind: plan\n---\n# Draft\n",
      "/repo/docs/plans/ready.md": "---\nkind: plan\nreadiness: ready\n---\n# Ready\n"
    });
    const now = Date.UTC(2026, 3, 7, 12, 0, 0);
    await fs.utimes?.("/repo/docs/plans/draft.md", now / 1000, now / 1000);
    await fs.utimes?.("/repo/docs/plans/ready.md", now / 1000 - 10, now / 1000 - 10);

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd)
    });

    expect(plans.map(({ title, readiness }) => ({ title, readiness }))).toEqual([
      { title: "Ready", readiness: "ready" },
      { title: "Draft", readiness: "draft" }
    ]);
  });

  it("scans the shared plan directory and classifies docs by frontmatter kind", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/architecture.md": "# Architecture\n\nFive-altitude design doc.\n",
      "/repo/docs/plans/plan-demo.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: first",
        "    title: First",
        "    prompt: First prompt",
        "    status: done",
        "  - id: second",
        "    title: Second",
        "    prompt: Second prompt",
        "    status: open",
        "---"
      ].join("\n"),
      "/repo/docs/plans/spawn-hooks.md": [
        "---",
        "kind: ralph",
        "agent: claude-code",
        "iterations: 3",
        "status:",
        "  state: in_progress",
        "  iteration: 2",
        "---",
        "# Spawn hooks"
      ].join("\n"),
      "/repo/docs/plans/speed-up-tests.md": [
        "---",
        "kind: experiment",
        "agent: claude-code",
        "metric:",
        "  name: test_duration",
        "  script: npm run metric:test_duration",
        "  direction: minimize",
        "baseline: null",
        "---",
        "# Speed up tests"
      ].join("\n"),
      "/repo/docs/plans/speed-up-tests.journal.jsonl": JSON.stringify({ status: "keep" }),
      "/repo/docs/plans/pi-mono.md": [
        "---",
        "kind: superintendent",
        "version: 1",
        "builder:",
        "  agent: codex",
        "  prompt: Build.",
        "superintendent:",
        "  agent: codex",
        "  prompt: Review.",
        "owner:",
        "  agent: codex",
        "  prompt: Approve.",
        "status:",
        "  state: review",
        "  round: 4",
        "  review_turn: 12",
        "---",
        "# Pi mono integration"
      ].join("\n"),
      "/repo/docs/plans/planner-base.md": [
        "---",
        "kind: superintendent-base",
        "---",
        "# Planner base"
      ].join("\n")
    });

    const now = Date.UTC(2026, 3, 7, 12, 0, 0);
    await fs.utimes?.("/repo/docs/plans/architecture.md", now / 1000 - 40, now / 1000 - 40);
    await fs.utimes?.("/repo/docs/plans/plan-demo.md", now / 1000 - 30, now / 1000 - 30);
    await fs.utimes?.("/repo/docs/plans/spawn-hooks.md", now / 1000 - 20, now / 1000 - 20);
    await fs.utimes?.("/repo/docs/plans/speed-up-tests.md", now / 1000 - 10, now / 1000 - 10);
    await fs.utimes?.("/repo/docs/plans/pi-mono.md", now / 1000, now / 1000);
    await fs.utimes?.("/repo/docs/plans/planner-base.md", now / 1000 - 5, now / 1000 - 5);

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd)
    });

    expect(
      plans.map((plan) => ({
        path: plan.path,
        kind: plan.kind,
        typeLabel: plan.typeLabel,
        runner: plan.runner,
        detail: plan.detail
      }))
    ).toEqual([
      {
        path: "docs/plans/pi-mono.md",
        kind: "superintendent",
        typeLabel: "Superintendent",
        runner: "superintendent",
        detail: "review 12"
      },
      {
        path: "docs/plans/planner-base.md",
        kind: "superintendent-base",
        typeLabel: "Superintendent Base",
        runner: undefined,
        detail: "base doc"
      },
      {
        path: "docs/plans/speed-up-tests.md",
        kind: "experiment",
        typeLabel: "Experiment",
        runner: "experiment",
        detail: "minimize · keep"
      },
      {
        path: "docs/plans/spawn-hooks.md",
        kind: "ralph",
        typeLabel: "Ralph",
        runner: "ralph",
        detail: "claude-code · in_progress 2"
      },
      {
        path: "docs/plans/plan-demo.md",
        kind: "pipeline",
        typeLabel: "Pipeline",
        runner: "pipeline",
        detail: "1/2 done"
      },
      {
        path: "docs/plans/architecture.md",
        kind: "plan",
        typeLabel: "Plan",
        runner: undefined,
        detail: "Architecture"
      }
    ]);
  });

  it("supports kind filters while scanning the shared plan directory once", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/architecture.md": "# Architecture\n",
      "/repo/docs/plans/spawn-hooks.md": ["---", "kind: ralph", "---", "# Spawn hooks"].join("\n")
    });

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd),
      kind: "plan"
    });

    expect(plans).toEqual([
      expect.objectContaining({
        path: "docs/plans/architecture.md",
        kind: "plan"
      })
    ]);
  });

  it("excludes README meta docs from the shared plan directory", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/README.md": "# Plans\n\nIndex of the plan directory.\n",
      "/repo/docs/plans/later/README.md": "# Saved for later\n",
      "/repo/docs/plans/architecture.md": "# Architecture\n"
    });

    const plans = await discoverAllPlans({
      cwd,
      homeDir,
      fs,
      configPath: resolveConfigPath(homeDir),
      projectConfigPath: resolveProjectConfigPath(cwd)
    });

    expect(plans.map((plan) => plan.path)).toEqual(["docs/plans/architecture.md"]);
  });

  it("derives a plan entry from one file snapshot", async () => {
    const baseFs = createMemFs({
      "/repo/docs/plans/feature.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: feature",
        "    title: Feature",
        "    prompt: Ship it",
        "    status: done",
        "---"
      ].join("\n")
    });
    let planReads = 0;
    const fs: DiscoveryFs = {
      ...baseFs,
      readFile: async (filePath, encoding) => {
        if (filePath === "/repo/docs/plans/feature.md") {
          planReads += 1;
          return planReads === 1 ? await baseFs.readFile(filePath, encoding) : "# Current plan\n";
        }
        return baseFs.readFile(filePath, encoding);
      }
    };

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([expect.objectContaining({ kind: "pipeline", detail: "1/1 done" })]);
    expect(planReads).toBe(1);
  });

  it("discovers yaml pipeline plans from the shared plan directory", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/feature.yaml": [
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: feature",
        "    title: Feature",
        "    prompt: Ship it",
        "    status: done"
      ].join("\n")
    });

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([
      expect.objectContaining({
        path: "docs/plans/feature.yaml",
        kind: "pipeline",
        typeLabel: "Pipeline",
        runner: "pipeline",
        format: "yaml",
        detail: "1/1 done"
      })
    ]);
  });

  it("discovers saved-for-later plans from the later subdirectory with their reason", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/active.md": "# Active\n",
      "/repo/docs/plans/later/deferred.md": [
        "---",
        "saved_for_later:",
        "  reason: Blocked on API contract",
        "---",
        "# Deferred"
      ].join("\n")
    });

    const now = Date.UTC(2026, 3, 7, 12, 0, 0);
    await fs.utimes?.("/repo/docs/plans/active.md", now / 1000, now / 1000);
    await fs.utimes?.("/repo/docs/plans/later/deferred.md", now / 1000 + 10, now / 1000 + 10);

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([
      expect.objectContaining({
        path: "docs/plans/active.md"
      }),
      expect.objectContaining({
        path: "docs/plans/later/deferred.md",
        savedForLater: {
          reason: "Blocked on API contract"
        }
      })
    ]);
  });

  it("skips broken symlinks while discovering valid plan files", async () => {
    const volume = Volume.fromJSON({ "/repo/docs/plans/real.md": "# Real\n" }, "/");
    volume.mkdirSync(cwd, { recursive: true });
    volume.mkdirSync(homeDir, { recursive: true });
    volume.symlinkSync("/repo/docs/plans/missing.md", "/repo/docs/plans/stale.md");
    const fs = createFsFromVolume(volume).promises as unknown as DiscoveryFs;

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([
      expect.objectContaining({
        path: "docs/plans/real.md",
        kind: "plan"
      })
    ]);
  });

  it("uses plan.plan_directory config and POE_PLAN_DIRECTORY overrides", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/config.json": JSON.stringify({
        plan: {
          plan_directory: "custom/plans"
        }
      }),
      "/repo/custom/plans/configured.md": "# Configured plan\n",
      "/repo/override/plans/override.md": "# Override plan\n"
    });

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([
      expect.objectContaining({
        path: "custom/plans/configured.md",
        kind: "plan"
      })
    ]);

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd),
        variables: {
          POE_PLAN_DIRECTORY: "override/plans"
        }
      })
    ).resolves.toEqual([
      expect.objectContaining({
        path: "override/plans/override.md",
        kind: "plan"
      })
    ]);
  });

  it("ignores inherited POE_PLAN_DIRECTORY overrides", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/configured.md": "# Configured plan\n",
      "/repo/override/plans/polluted.md": "# Polluted plan\n"
    });

    await withObjectPrototypeProperties({ POE_PLAN_DIRECTORY: "override/plans" }, async () => {
      await expect(
        discoverAllPlans({
          cwd,
          homeDir,
          fs,
          configPath: resolveConfigPath(homeDir),
          projectConfigPath: resolveProjectConfigPath(cwd),
          variables: {}
        })
      ).resolves.toEqual([
        expect.objectContaining({
          path: "docs/plans/configured.md",
          kind: "plan"
        })
      ]);
    });
  });

  it("does not treat inherited realpath error codes as missing plan directories", async () => {
    const raw = createMemFs({ "/repo/docs/plans/plan.md": "# Plan\n" });
    const fs: DiscoveryFs = {
      ...raw,
      realpath: async (filePath) => {
        if (filePath === "/repo/docs/plans") {
          throw new Error("realpath denied");
        }

        return raw.realpath(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        discoverAllPlans({
          cwd,
          homeDir,
          fs,
          configPath: resolveConfigPath(homeDir),
          projectConfigPath: resolveProjectConfigPath(cwd)
        })
      ).rejects.toThrow("realpath denied");
    });
  });

  it("does not treat inherited readdir error codes as missing plan directories", async () => {
    const raw = createMemFs({ "/repo/docs/plans/plan.md": "# Plan\n" });
    const fs: DiscoveryFs = {
      ...raw,
      readdir: async (filePath) => {
        if (filePath === "/repo/docs/plans") {
          throw new Error("readdir denied");
        }

        return raw.readdir(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        discoverAllPlans({
          cwd,
          homeDir,
          fs,
          configPath: resolveConfigPath(homeDir),
          projectConfigPath: resolveProjectConfigPath(cwd)
        })
      ).rejects.toThrow("readdir denied");
    });
  });

  it("does not repair invalid project configuration while discovering plans", async () => {
    const volume = Volume.fromJSON(
      {
        "/repo/.poe-code/config.json": "{ invalid json\n",
        "/repo/docs/plans/one.md": "# One\n"
      },
      "/"
    );
    volume.mkdirSync(homeDir, { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as DiscoveryFs;

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).rejects.toThrow(SyntaxError);

    await expect(fs.readFile("/repo/.poe-code/config.json", "utf8")).resolves.toBe(
      "{ invalid json\n"
    );
    await expect(fs.readdir("/repo/.poe-code")).resolves.toEqual(["config.json"]);
  });

  it("does not fall back to legacy per-harness directories", async () => {
    const fs = createMemFs({
      "/repo/.poe-code/pipeline/plans/legacy-pipeline.md": [
        "---",
        "kind: pipeline",
        "tasks:",
        "  - id: first",
        "    title: First",
        "    prompt: First prompt",
        "    status: open",
        "---"
      ].join("\n"),
      "/repo/.poe-code/experiments/legacy-experiment.md": [
        "---",
        "kind: experiment",
        "agent: claude-code",
        "metric:",
        "  name: test_duration",
        "  script: npm run metric:test_duration",
        "  direction: minimize",
        "baseline: null",
        "---",
        "# Legacy experiment"
      ].join("\n"),
      "/repo/.poe-code/ralph/plans/legacy-ralph.md": [
        "---",
        "kind: ralph",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Legacy Ralph"
      ].join("\n")
    });

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([]);
  });

  it("classifies frontmatter documents without kind as generic plans", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/plan-markdown-reader.md": [
        "---",
        "vars:",
        "  plan_doc: \"{{file 'docs/plans/markdown-reader.md'}}\"",
        "tasks:",
        "  - id: task-1",
        "    title: Task 1",
        "    prompt: Ship it",
        "    status: open",
        "---"
      ].join("\n")
    });

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).resolves.toEqual([
      expect.objectContaining({
        path: "docs/plans/plan-markdown-reader.md",
        kind: "plan"
      })
    ]);
  });

  it("rejects symlinked plan directories and plan files", async () => {
    const linkedDirectoryVolume = Volume.fromJSON({ "/outside/plan.md": "# External" }, "/");
    linkedDirectoryVolume.mkdirSync("/repo/docs", { recursive: true });
    linkedDirectoryVolume.mkdirSync(homeDir, { recursive: true });
    linkedDirectoryVolume.symlinkSync("/outside", "/repo/docs/plans");
    const linkedDirectoryFs = createFsFromVolume(linkedDirectoryVolume)
      .promises as unknown as DiscoveryFs;

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs: linkedDirectoryFs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).rejects.toThrow("Plan directory must not be a symbolic link");

    const linkedFileVolume = Volume.fromJSON({ "/outside.md": "# External" }, "/");
    linkedFileVolume.mkdirSync("/repo/docs/plans", { recursive: true });
    linkedFileVolume.mkdirSync(homeDir, { recursive: true });
    linkedFileVolume.symlinkSync("/outside.md", "/repo/docs/plans/local.md");
    const linkedFileFs = createFsFromVolume(linkedFileVolume).promises as unknown as DiscoveryFs;

    await expect(
      discoverAllPlans({
        cwd,
        homeDir,
        fs: linkedFileFs,
        configPath: resolveConfigPath(homeDir),
        projectConfigPath: resolveProjectConfigPath(cwd)
      })
    ).rejects.toThrow("Plan file must not be a symbolic link");
  });
});
