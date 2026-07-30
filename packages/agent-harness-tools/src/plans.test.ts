import { TaskNotFoundError, type TaskListFs } from "@poe-code/task-list";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { archivePlan, discoverPlans, openPlanList } from "./plans.js";

const cwd = "/repo";
const homeDir = "/home/test";
const planDirectory = ".poe-code/plans";
const resolvedPlanDirectory = "/repo/.poe-code/plans";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): {
  fs: TaskListFs;
  rawFs: TestFs;
  volume: Volume;
} {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  const rawFs = createFsFromVolume(volume).promises;

  return {
    fs: rawFs as unknown as TaskListFs,
    rawFs,
    volume
  };
}

function planDoc(options: { kind?: string; name?: string; state?: string; readiness?: string; body?: string }): string {
  const frontmatter = [
    options.kind === undefined ? undefined : `kind: ${options.kind}`,
    options.name === undefined ? undefined : `name: ${options.name}`,
    options.readiness === undefined ? undefined : `readiness: ${options.readiness}`,
    `state: ${options.state ?? "draft"}`
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return `---
${frontmatter}
---

${options.body ?? ""}`;
}

async function readSortedDirectory(rawFs: TestFs, directory: string): Promise<string[]> {
  return (await rawFs.readdir(directory)).sort();
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

describe("plans", () => {
  it("discoverPlans returns plans with kind from frontmatter and metadata", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-build-pipeline.md": planDoc({
        kind: "pipeline",
        name: "Build pipeline",
        readiness: "ready"
      })
    });

    await expect(
      discoverPlans({
        cwd,
        homeDir,
        planDirectory,
        fs
      })
    ).resolves.toEqual([
      {
        id: "build-pipeline",
        name: "Build pipeline",
        kind: "pipeline",
        readiness: "ready",
        absolutePath: "/repo/.poe-code/plans/01-build-pipeline.md",
        displayPath: ".poe-code/plans/01-build-pipeline.md"
      }
    ]);

    const taskList = await openPlanList({
      cwd,
      homeDir,
      planDirectory,
      fs
    });
    await expect(taskList.list("plans").get("build-pipeline")).resolves.toMatchObject({
      metadata: {
        kind: "pipeline",
        readiness: "ready"
      }
    });
  });

  it("sorts ready plans before drafts while preserving source order", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-draft.md": planDoc({ kind: "pipeline", name: "Draft" }),
      "/repo/.poe-code/plans/02-ready.md": planDoc({
        kind: "pipeline",
        name: "Ready",
        readiness: "ready"
      }),
      "/repo/.poe-code/plans/03-explicit-draft.md": planDoc({
        kind: "pipeline",
        name: "Explicit draft",
        readiness: "draft"
      })
    });

    const plans = await discoverPlans({ cwd, homeDir, planDirectory, fs });

    expect(plans.map(({ id, readiness }) => ({ id, readiness }))).toEqual([
      { id: "ready", readiness: "ready" },
      { id: "draft", readiness: "draft" },
      { id: "explicit-draft", readiness: "draft" }
    ]);
  });

  it("sorts plans by newest modification time within each readiness group", async () => {
    const { fs, rawFs } = createFs({
      "/repo/.poe-code/plans/ready-older.md": planDoc({ readiness: "ready" }),
      "/repo/.poe-code/plans/ready-newer.md": planDoc({ readiness: "ready" }),
      "/repo/.poe-code/plans/draft-older.md": planDoc({}),
      "/repo/.poe-code/plans/draft-newer.md": planDoc({})
    });
    await rawFs.utimes("/repo/.poe-code/plans/ready-older.md", 1, 1);
    await rawFs.utimes("/repo/.poe-code/plans/ready-newer.md", 4, 4);
    await rawFs.utimes("/repo/.poe-code/plans/draft-older.md", 2, 2);
    await rawFs.utimes("/repo/.poe-code/plans/draft-newer.md", 3, 3);

    const plans = await discoverPlans({ cwd, homeDir, planDirectory, fs });

    expect(plans.map((plan) => plan.id)).toEqual([
      "ready-newer",
      "ready-older",
      "draft-newer",
      "draft-older"
    ]);
  });

  it("rejects unsupported readiness metadata", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/invalid.md": planDoc({ readiness: "review" })
    });

    await expect(discoverPlans({ cwd, homeDir, planDirectory, fs })).rejects.toThrow(
      'Invalid plan readiness "review"'
    );
  });

  it("discoverPlans filters by kind", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-first.md": planDoc({
        kind: "plan",
        name: "First"
      }),
      "/repo/.poe-code/plans/02-second.md": planDoc({
        kind: "pipeline",
        name: "Second"
      })
    });

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory,
      kinds: ["pipeline"],
      fs
    });

    expect(plans).toEqual([
      {
        id: "second",
        name: "Second",
        kind: "pipeline",
        readiness: "draft",
        absolutePath: "/repo/.poe-code/plans/02-second.md",
        displayPath: ".poe-code/plans/02-second.md"
      }
    ]);
  });

  it("discoverPlans skips plans with no frontmatter when filtering by kind", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-bare.md": `# Plain doc

No frontmatter here.
`,
      "/repo/.poe-code/plans/02-pipeline.md": planDoc({
        kind: "pipeline",
        name: "Pipe"
      })
    });

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory,
      kinds: ["pipeline"],
      fs
    });

    expect(plans.map((plan) => plan.id)).toEqual(["pipeline"]);
  });

  it("discoverPlans includes plans with no frontmatter under default kind 'plan'", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-bare.md": `# Plain doc

No frontmatter here.
`
    });

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory,
      fs
    });

    expect(plans).toEqual([
      {
        id: "bare",
        name: "bare",
        kind: "plan",
        readiness: "draft",
        absolutePath: "/repo/.poe-code/plans/01-bare.md",
        displayPath: ".poe-code/plans/01-bare.md"
      }
    ]);
  });

  it("discoverPlans defaults kind to plan and supports unprefixed filenames", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/backlog.md": planDoc({
        name: "Backlog"
      })
    });

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory,
      kinds: ["plan"],
      fs
    });

    expect(plans).toEqual([
      {
        id: "backlog",
        name: "Backlog",
        kind: "plan",
        readiness: "draft",
        absolutePath: "/repo/.poe-code/plans/backlog.md",
        displayPath: ".poe-code/plans/backlog.md"
      }
    ]);
  });

  it("discoverPlans formats display paths under the home directory", async () => {
    const { fs } = createFs({
      "/home/test/.poe-code/plans/01-global.md": planDoc({
        kind: "pipeline",
        name: "Global"
      })
    });

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory: "~/.poe-code/plans",
      fs
    });

    expect(plans).toEqual([
      {
        id: "global",
        name: "Global",
        kind: "pipeline",
        readiness: "draft",
        absolutePath: "/home/test/.poe-code/plans/01-global.md",
        displayPath: "~/.poe-code/plans/01-global.md"
      }
    ]);
  });

  it("discoverPlans returns an empty list when the directory does not exist", async () => {
    const { fs } = createFs();

    await expect(
      discoverPlans({
        cwd,
        homeDir,
        planDirectory,
        fs
      })
    ).resolves.toEqual([]);
  });

  it("does not treat inherited stat error codes as missing plan directories", async () => {
    const { fs: rawFs } = createFs();
    const fs: TaskListFs = {
      ...rawFs,
      stat: async (filePath) => {
        if (filePath === resolvedPlanDirectory) {
          throw new Error("stat denied");
        }

        return rawFs.stat(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        discoverPlans({
          cwd,
          homeDir,
          planDirectory,
          fs
        })
      ).rejects.toThrow("stat denied");
    });
  });

  it("discoverPlans ignores archive and non-plan subdirectories", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-active.md": planDoc({
        name: "Active"
      }),
      "/repo/.poe-code/plans/archive/archived.md": planDoc({
        name: "Archived"
      }),
      "/repo/.poe-code/plans/notes/note.md": planDoc({
        name: "Nested"
      })
    });

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory,
      fs
    });

    expect(plans.map((plan) => plan.id)).toEqual(["active"]);
  });

  it("rejects duplicate normalized active plan identifiers", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-feature.md": planDoc({ name: "First" }),
      "/repo/.poe-code/plans/02-feature.md": planDoc({ name: "Second" })
    });

    await expect(discoverPlans({ cwd, homeDir, planDirectory, fs }))
      .rejects.toThrow(/duplicate.*feature/i);
  });

  it("archivePlan moves files to archive without renumbering remaining plans", async () => {
    const { fs, rawFs } = createFs({
      "/repo/.poe-code/plans/01-first.md": planDoc({
        name: "First"
      }),
      "/repo/.poe-code/plans/02-second.md": planDoc({
        name: "Second"
      }),
      "/repo/.poe-code/plans/03-third.md": planDoc({
        name: "Third"
      })
    });

    await archivePlan({
      cwd,
      homeDir,
      planDirectory,
      id: "second",
      fs
    });

    await expect(readSortedDirectory(rawFs, resolvedPlanDirectory)).resolves.toEqual([
      "01-first.md",
      "03-third.md",
      "archive"
    ]);
    await expect(readSortedDirectory(rawFs, `${resolvedPlanDirectory}/archive`)).resolves.toEqual([
      "second.md"
    ]);

    const plans = await discoverPlans({
      cwd,
      homeDir,
      planDirectory,
      fs
    });

    expect(plans.map((plan) => plan.absolutePath)).toEqual([
      "/repo/.poe-code/plans/01-first.md",
      "/repo/.poe-code/plans/03-third.md"
    ]);
  });

  it("archivePlan throws TaskNotFoundError for an unknown id", async () => {
    const { fs } = createFs({
      "/repo/.poe-code/plans/01-known.md": planDoc({
        name: "Known"
      })
    });

    await expect(
      archivePlan({
        cwd,
        homeDir,
        planDirectory,
        id: "missing",
        fs
      })
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});
