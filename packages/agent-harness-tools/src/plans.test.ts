import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { TaskNotFoundError, type TaskListFs } from "@poe-code/task-list";
import {
  archivePlan,
  discoverPlans,
  openPlanList,
  type DiscoverPlansOptions
} from "./plans.js";

const cwd = "/repo";
const homeDir = "/home/test";
const planDirectory = ".poe-code/plans";

type TestFs = TaskListFs;

function createFs(
  files: Record<string, string>,
  directories: string[] = []
): {
  fs: TestFs;
  rawFs: ReturnType<typeof createFsFromVolume>;
} {
  const volume = Volume.fromJSON(files, "/");

  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });

  for (const directory of directories) {
    volume.mkdirSync(directory, { recursive: true });
  }

  const rawFs = createFsFromVolume(volume);
  return { fs: rawFs.promises as unknown as TestFs, rawFs };
}

function planDocument(options: { name?: string; kind?: string; state?: string } = {}): string {
  const lines = ["---"];

  if (options.name !== undefined) {
    lines.push(`name: ${options.name}`);
  }

  if (options.kind !== undefined) {
    lines.push(`kind: ${options.kind}`);
  }

  if (options.state !== undefined) {
    lines.push(`state: ${options.state}`);
  }

  lines.push("---", "", "");
  return lines.join("\n");
}

function discoverOptions(fs: TestFs): DiscoverPlansOptions {
  return {
    cwd,
    homeDir,
    planDirectory,
    fs
  };
}

async function markdownEntries(
  rawFs: ReturnType<typeof createFsFromVolume>,
  directoryPath: string
): Promise<string[]> {
  const entries = await rawFs.promises.readdir(directoryPath);
  return entries
    .filter((entryName) => entryName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));
}

describe("plans", () => {
  it("discovers plans with kind from frontmatter metadata", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-build-pipeline.md": planDocument({
        kind: "pipeline"
      }),
      "/repo/.poe-code/plans/02-plain-plan.md": planDocument({
        name: "Plain plan"
      })
    });

    await expect(discoverPlans(discoverOptions(fs))).resolves.toEqual([
      {
        id: "build-pipeline",
        name: "build-pipeline",
        kind: "pipeline",
        absolutePath: "/repo/.poe-code/plans/01-build-pipeline.md",
        displayPath: ".poe-code/plans/01-build-pipeline.md"
      },
      {
        id: "plain-plan",
        name: "Plain plan",
        kind: "plan",
        absolutePath: "/repo/.poe-code/plans/02-plain-plan.md",
        displayPath: ".poe-code/plans/02-plain-plan.md"
      }
    ]);
  });

  it("filters discovered plans by kind", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-build-pipeline.md": planDocument({
        kind: "pipeline"
      }),
      "/repo/.poe-code/plans/02-plain-plan.md": planDocument({
        kind: "plan"
      })
    });

    const plans = await discoverPlans({
      ...discoverOptions(fs),
      kinds: ["pipeline"]
    });

    expect(plans).toEqual([
      expect.objectContaining({
        id: "build-pipeline",
        kind: "pipeline"
      })
    ]);
  });

  it("filters discovered plans by the default plan kind", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-build-pipeline.md": planDocument({
        kind: "pipeline"
      }),
      "/repo/.poe-code/plans/02-plain-plan.md": planDocument({
        name: "Plain plan"
      })
    });

    const plans = await discoverPlans({
      ...discoverOptions(fs),
      kinds: ["plan"]
    });

    expect(plans).toEqual([
      expect.objectContaining({
        id: "plain-plan",
        kind: "plan"
      })
    ]);
  });

  it("keeps plan kind in task metadata when opening the underlying list", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-build-pipeline.md": planDocument({
        kind: "pipeline"
      })
    });

    const taskList = await openPlanList(discoverOptions(fs));

    await expect(taskList.list("plans").get("build-pipeline")).resolves.toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          kind: "pipeline"
        })
      })
    );
  });

  it("skips files without frontmatter when discovering plans", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-pipeline.md": planDocument({
        kind: "pipeline"
      }),
      "/repo/.poe-code/plans/02-free-form.md":
        "# Free-form planning doc\n\nNo frontmatter here.\n",
      "/repo/.poe-code/plans/03-another-pipeline.md": planDocument({
        kind: "pipeline"
      })
    });

    const plans = await discoverPlans({
      ...discoverOptions(fs),
      kinds: ["pipeline"]
    });

    expect(plans.map((plan) => plan.id)).toEqual(["pipeline", "another-pipeline"]);
  });

  it("returns an empty list when the plan directory does not exist", async () => {
    const { fs } = createFs({});

    await expect(discoverPlans(discoverOptions(fs))).resolves.toEqual([]);
  });

  it("uses home-relative display paths for plans outside the workspace under home", async () => {
    const { fs } = createFs({
      "/home/test/.poe-code/plans/01-global.md": planDocument({
        name: "Global"
      })
    });

    await expect(
      discoverPlans({
        cwd,
        homeDir,
        planDirectory: "~/.poe-code/plans",
        fs
      })
    ).resolves.toEqual([
      expect.objectContaining({
        absolutePath: "/home/test/.poe-code/plans/01-global.md",
        displayPath: "~/.poe-code/plans/01-global.md"
      })
    ]);
  });

  it("uses absolute display paths for plans outside the workspace and home", async () => {
    const { fs } = createFs({
      "/tmp/plans/01-external.md": planDocument({
        name: "External"
      })
    });

    await expect(
      discoverPlans({
        cwd,
        homeDir,
        planDirectory: "/tmp/plans",
        fs
      })
    ).resolves.toEqual([
      expect.objectContaining({
        absolutePath: "/tmp/plans/01-external.md",
        displayPath: "/tmp/plans/01-external.md"
      })
    ]);
  });

  it("ignores archive and non-plan subdirectories", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-active.md": planDocument({
        kind: "plan"
      }),
      "/repo/.poe-code/plans/archive/archived.md": planDocument({
        kind: "pipeline",
        state: "archived"
      }),
      "/repo/.poe-code/plans/notes/ignored.md": planDocument({
        kind: "pipeline"
      })
    });

    await expect(discoverPlans(discoverOptions(fs))).resolves.toEqual([
      expect.objectContaining({
        id: "active",
        kind: "plan"
      })
    ]);
  });

  it("archives plans and discovers renumbered active prefixes", async () => {
    const { fs, rawFs } = createFs({
      "/repo/.poe-code/plans/01-alpha.md": planDocument({
        kind: "plan"
      }),
      "/repo/.poe-code/plans/02-beta.md": planDocument({
        kind: "pipeline"
      }),
      "/repo/.poe-code/plans/03-gamma.md": planDocument({
        kind: "plan"
      })
    });

    await archivePlan({
      ...discoverOptions(fs),
      id: "beta"
    });

    await expect(markdownEntries(rawFs, "/repo/.poe-code/plans")).resolves.toEqual([
      "01-alpha.md",
      "02-gamma.md"
    ]);
    await expect(markdownEntries(rawFs, "/repo/.poe-code/plans/archive")).resolves.toEqual([
      "beta.md"
    ]);
    await expect(discoverPlans(discoverOptions(fs))).resolves.toEqual([
      expect.objectContaining({
        id: "alpha",
        absolutePath: "/repo/.poe-code/plans/01-alpha.md"
      }),
      expect.objectContaining({
        id: "gamma",
        absolutePath: "/repo/.poe-code/plans/02-gamma.md"
      })
    ]);
  });

  it("throws TaskNotFoundError when archiving an unknown plan id", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-alpha.md": planDocument({
        kind: "plan"
      })
    });

    await expect(
      archivePlan({
        ...discoverOptions(fs),
        id: "missing"
      })
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});
