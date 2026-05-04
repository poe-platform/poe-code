import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { MalformedTaskError, type TaskListFs } from "../types.js";
import { markdownDirBackend } from "./markdown-dir.js";
import { createDeferred, createFs, flushMicrotasks, waitForCondition } from "./test-helpers.js";

type TestFs = ReturnType<typeof createFs>["rawFs"];

function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  const closingIndex = lines.indexOf("---", 1);

  if (closingIndex === -1) {
    throw new Error("Missing frontmatter terminator.");
  }

  const document = parseDocument(lines.slice(1, closingIndex).join("\n"));

  return document.toJS() as Record<string, unknown>;
}

function taskDocument(name: string, state = "draft"): string {
  return `---
name: ${name}
state: ${state}
---

`;
}

async function markdownEntries(rawFs: TestFs, directoryPath: string): Promise<string[]> {
  const entries = await rawFs.readdir(directoryPath);
  return entries
    .filter((entryName) => entryName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));
}

async function recursiveListing(
  rawFs: TestFs,
  directoryPath: string,
  prefix = ""
): Promise<string[]> {
  const entries = await rawFs.readdir(directoryPath);
  const listing: string[] = [];

  for (const entryName of entries.sort((left, right) => left.localeCompare(right))) {
    const relativePath = prefix === "" ? entryName : `${prefix}/${entryName}`;
    const entryPath = path.join(directoryPath, entryName);
    const entryStat = await rawFs.stat(entryPath);

    if (entryStat.isDirectory()) {
      listing.push(`${relativePath}/`);
      listing.push(...(await recursiveListing(rawFs, entryPath, relativePath)));
    } else {
      listing.push(relativePath);
    }
  }

  return listing;
}

describe("markdownDirBackend", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates the root directory only when create is true", async () => {
    const missingRoot = createFs();

    await expect(
      openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks",
        fs: missingRoot.fs
      })
    ).rejects.toMatchObject({
      code: "ENOENT"
    });

    await expect(
      openTaskList({
        type: "markdown-dir",
        path: "/repo/tasks",
        create: true,
        fs: missingRoot.fs
      })
    ).resolves.toBeDefined();
    await expect(missingRoot.rawFs.stat("/repo/tasks")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("keeps list directories lazy until the first create", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    taskList.list("planning");

    await expect(rawFs.stat("/repo/tasks/planning")).rejects.toMatchObject({
      code: "ENOENT"
    });

    await taskList.list("planning").create({
      id: "lazy",
      name: "Lazy create"
    });

    await expect(rawFs.stat("/repo/tasks/planning")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
  });

  it("preserves unknown frontmatter keys during updates", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/custom.md": `---
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json
kind: task
version: 1
name: Custom task
state: draft
owner: kj
estimate: 3
---

Initial body`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("planning").update("custom", {
      name: "Updated custom",
      metadata: {
        owner: "pm"
      }
    });

    const content = await rawFs.readFile("/repo/tasks/planning/custom.md", "utf8");

    expect(parseFrontmatter(content)).toMatchObject({
      owner: "pm",
      estimate: 3
    });
  });

  it("throws MalformedTaskError with the file path and field name", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/bad.md": `---
name: Bad task
state: not-a-real-state
---

Broken`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.list("planning").get("bad")).rejects.toEqual(
      expect.objectContaining({
        name: "MalformedTaskError",
        message: expect.stringContaining("/repo/tasks/planning/bad.md")
      })
    );
    await expect(taskList.list("planning").get("bad")).rejects.toThrow('"state"');
    await expect(taskList.list("planning").get("bad")).rejects.toBeInstanceOf(MalformedTaskError);
  });

  it("skips files without frontmatter in all() when ignoreMalformed is true", async () => {
    const { fs } = createFs({
      "/repo/tasks/01-valid.md": `---
kind: pipeline
state: draft
---

Body`,
      "/repo/tasks/02-no-frontmatter.md": "# Just a heading\n\nFree-form planning doc.\n",
      "/repo/tasks/03-also-valid.md": `---
kind: pipeline
state: draft
---

Body`
    });
    const taskList = await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      ignoreMalformed: true,
      fs
    });

    const tasks = await taskList.list("plans").all();

    expect(tasks.map((task) => task.id)).toEqual(["valid", "also-valid"]);
  });

  it("propagates MalformedTaskError from all() when ignoreMalformed is false", async () => {
    const { fs } = createFs({
      "/repo/tasks/01-valid.md": `---
kind: pipeline
state: draft
---

Body`,
      "/repo/tasks/02-no-frontmatter.md": "# Just a heading\n"
    });
    const taskList = await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      fs
    });

    await expect(taskList.list("plans").all()).rejects.toBeInstanceOf(MalformedTaskError);
  });

  it("still throws MalformedTaskError from get() when ignoreMalformed is true", async () => {
    const { fs } = createFs({
      "/repo/tasks/01-broken.md": "# Just a heading\n"
    });
    const taskList = await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      ignoreMalformed: true,
      fs
    });

    await expect(taskList.list("plans").get("broken")).rejects.toBeInstanceOf(MalformedTaskError);
  });

  it("rejects non-task frontmatter in strict mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/pipeline.md": `---
kind: pipeline
name: Pipeline plan
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.list("planning").get("pipeline")).rejects.toBeInstanceOf(
      MalformedTaskError
    );
    await expect(taskList.list("planning").get("pipeline")).rejects.toThrow('"kind"');
  });

  it("reads and updates non-task frontmatter in passthrough mode", async () => {
    const pipelineSchema =
      "https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json";
    const { fs, rawFs } = createFs({
      "/repo/tasks/foo.md": `---
$schema: ${pipelineSchema}
kind: pipeline
version: 1
---

`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.list("plans").get("foo")).resolves.toMatchObject({
      state: "draft",
      name: "foo",
      metadata: {
        $schema: pipelineSchema,
        kind: "pipeline",
        version: 1
      }
    });

    await taskList.list("plans").fire("foo", "plan");

    const content = await rawFs.readFile("/repo/tasks/foo.md", "utf8");
    expect(parseFrontmatter(content)).toMatchObject({
      $schema: pipelineSchema,
      kind: "pipeline",
      version: 1,
      state: "planned"
    });
    expect(parseFrontmatter(content)).not.toHaveProperty("name");
  });

  it("uses the parsed filename id for passthrough synthesized names without persisting them", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/07-prefixed.md": `---
kind: pipeline
state: not-a-state
---

`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.list("plans").get("prefixed")).resolves.toMatchObject({
      id: "prefixed",
      name: "prefixed",
      state: "draft",
      metadata: {
        kind: "pipeline"
      }
    });

    await taskList.list("plans").fire("prefixed", "plan");

    const frontmatter = parseFrontmatter(
      await rawFs.readFile("/repo/tasks/07-prefixed.md", "utf8")
    );
    expect(frontmatter).toMatchObject({
      kind: "pipeline",
      state: "planned"
    });
    expect(frontmatter).not.toHaveProperty("name");
  });

  it("updates passthrough metadata without injecting synthesized fields", async () => {
    const pipelineSchema =
      "https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json";
    const { fs, rawFs } = createFs({
      "/repo/tasks/foo.md": `---
$schema: ${pipelineSchema}
kind: pipeline
version: 1
---

`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(
      taskList.list("plans").update("foo", {
        description: "Updated body",
        metadata: {
          owner: "kj"
        }
      })
    ).resolves.toMatchObject({
      name: "foo",
      state: "draft",
      description: "Updated body",
      metadata: {
        $schema: pipelineSchema,
        kind: "pipeline",
        version: 1,
        owner: "kj"
      }
    });

    const content = await rawFs.readFile("/repo/tasks/foo.md", "utf8");
    const frontmatter = parseFrontmatter(content);
    expect(frontmatter).toMatchObject({
      $schema: pipelineSchema,
      kind: "pipeline",
      version: 1,
      owner: "kj"
    });
    expect(frontmatter).not.toHaveProperty("name");
    expect(frontmatter).not.toHaveProperty("state");
    expect(content).toContain("Updated body");
  });

  it("does not inject task envelope fields when creating passthrough markdown", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(
      taskList.list("plans").create({
        id: "new-plan",
        name: "New plan",
        metadata: {
          kind: "pipeline"
        }
      })
    ).resolves.toMatchObject({
      metadata: {
        kind: "pipeline"
      }
    });

    const frontmatter = parseFrontmatter(
      await rawFs.readFile("/repo/tasks/01-new-plan.md", "utf8")
    );
    expect(frontmatter).toMatchObject({
      name: "New plan",
      state: "draft",
      kind: "pipeline"
    });
    expect(frontmatter).not.toHaveProperty("$schema");
    expect(frontmatter).not.toHaveProperty("version");
    expect(frontmatter).not.toHaveProperty("created");
  });

  it("ignores hidden entries, lockfiles, and the reserved archive directory at the root", async () => {
    const { fs } = createFs({
      "/repo/tasks/alpha/one.md": `---
name: One
state: draft
---
`,
      "/repo/tasks/archive/ignored.md": `---
name: Ignored
state: archived
---
`,
      "/repo/tasks/.hidden/file.md": `---
name: Hidden
state: draft
---
`,
      "/repo/tasks/beta.md.lock": "",
      "/repo/tasks/readme.txt": "not a list"
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.lists()).resolves.toEqual(["alpha"]);
  });

  it("uses the root directory as the only list in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": taskDocument("Foo"),
      "/repo/tasks/01-bar.md": taskDocument("Bar")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "strict",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.lists()).resolves.toEqual(["plans"]);
    await expect(taskList.list("plans").all()).resolves.toEqual([
      expect.objectContaining({
        id: "bar",
        list: "plans",
        qualifiedId: "plans/bar",
        name: "Bar"
      }),
      expect.objectContaining({
        id: "foo",
        list: "plans",
        qualifiedId: "plans/foo",
        name: "Foo"
      })
    ]);
  });

  it("rejects unknown lists in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "strict",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    expect(() => taskList.list("other")).toThrow('Task list "other" not found.');
  });

  it("does not support moving between lists in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": taskDocument("Foo")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "strict",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.moveBetweenLists("plans/foo", "plans")).rejects.toThrow(
      "moveBetweenLists is unsupported in single-list mode."
    );
  });

  it("creates and archives tasks at the root in single-list mode", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "strict",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("plans").create({
      id: "write-root",
      name: "Write root"
    });

    await expect(rawFs.readFile("/repo/tasks/01-write-root.md", "utf8")).resolves.toContain(
      "name: Write root"
    );
    await expect(rawFs.stat("/repo/tasks/plans")).rejects.toMatchObject({
      code: "ENOENT"
    });

    await taskList.list("plans").fire("write-root", "archive");

    await expect(rawFs.stat("/repo/tasks/01-write-root.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(rawFs.readFile("/repo/tasks/archive/write-root.md", "utf8")).resolves.toContain(
      "state: archived"
    );
    await expect(taskList.list("plans").get("write-root")).resolves.toMatchObject({
      id: "write-root",
      list: "plans",
      state: "archived"
    });
  });

  it("ignores root subdirectories when reading active tasks in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": taskDocument("Foo"),
      "/repo/tasks/poe-agent/ignored.md": taskDocument("Ignored")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "strict",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await expect(taskList.list("plans").all()).resolves.toEqual([
      expect.objectContaining({
        id: "foo",
        list: "plans",
        qualifiedId: "plans/foo",
        name: "Foo"
      })
    ]);
  });

  it('rejects the reserved "archive" list name', async () => {
    const { fs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    expect(() => taskList.list("archive")).toThrow('Invalid task list name "archive".');
  });

  it("moves archived tasks into the archive directory", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("planning").create({
      id: "archive-me",
      name: "Archive me"
    });
    await taskList.list("planning").fire("archive-me", "archive");

    await expect(rawFs.stat("/repo/tasks/planning/archive-me.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      rawFs.readFile("/repo/tasks/planning/archive/archive-me.md", "utf8")
    ).resolves.toContain("state: archived");
  });

  it("re-packs active prefixes when archiving a multi-list task", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/01-foo.md": taskDocument("Foo"),
      "/repo/tasks/planning/02-bar.md": taskDocument("Bar"),
      "/repo/tasks/planning/03-baz.md": taskDocument("Baz")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("planning").fire("bar", "archive");

    await expect(markdownEntries(rawFs, "/repo/tasks/planning")).resolves.toEqual([
      "01-foo.md",
      "02-baz.md"
    ]);
    await expect(markdownEntries(rawFs, "/repo/tasks/planning/archive")).resolves.toEqual([
      "bar.md"
    ]);
    await expect(recursiveListing(rawFs, "/repo/tasks/planning")).resolves.toMatchInlineSnapshot(`
      [
        "01-foo.md",
        "02-baz.md",
        "archive/",
        "archive/bar.md",
      ]
    `);
  });

  it("re-packs active prefixes when archiving a single-list root task", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/01-foo.md": taskDocument("Foo"),
      "/repo/tasks/02-bar.md": taskDocument("Bar"),
      "/repo/tasks/03-baz.md": taskDocument("Baz")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("plans").fire("bar", "archive");

    await expect(markdownEntries(rawFs, "/repo/tasks")).resolves.toEqual([
      "01-foo.md",
      "02-baz.md"
    ]);
    await expect(markdownEntries(rawFs, "/repo/tasks/archive")).resolves.toEqual(["bar.md"]);
    await expect(recursiveListing(rawFs, "/repo/tasks")).resolves.toMatchInlineSnapshot(`
      [
        "01-foo.md",
        "02-baz.md",
        "archive/",
        "archive/bar.md",
      ]
    `);
  });

  it("leaves no active markdown files when archiving the only single-list task", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/01-only.md": taskDocument("Only")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("plans").fire("only", "archive");

    await expect(markdownEntries(rawFs, "/repo/tasks")).resolves.toEqual([]);
    await expect(markdownEntries(rawFs, "/repo/tasks/archive")).resolves.toEqual(["only.md"]);
  });

  it("leaves only the archive directory when archiving the only multi-list task", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/01-only.md": taskDocument("Only")
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("planning").fire("only", "archive");

    await expect(rawFs.readdir("/repo/tasks/planning")).resolves.toEqual(["archive"]);
    await expect(markdownEntries(rawFs, "/repo/tasks/planning/archive")).resolves.toEqual([
      "only.md"
    ]);
  });

  it("serializes concurrent archive prefix re-packs under the list lock", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const baseFs = createFs({
      "/repo/tasks/planning/01-foo.md": taskDocument("Foo"),
      "/repo/tasks/planning/02-bar.md": taskDocument("Bar"),
      "/repo/tasks/planning/03-baz.md": taskDocument("Baz"),
      "/repo/tasks/planning/04-qux.md": taskDocument("Qux")
    });
    const archiveRenames = [createDeferred(), createDeferred()];
    const startedArchiveIds: string[] = [];
    const fs: TaskListFs = {
      ...baseFs.fs,
      rename: async (oldPath, newPath) => {
        const archivePrefix = "/repo/tasks/planning/archive/";
        const targetPath = String(newPath);

        if (
          targetPath.startsWith(archivePrefix) &&
          targetPath.endsWith(".md") &&
          startedArchiveIds.length < archiveRenames.length
        ) {
          const archiveId = path.basename(targetPath, ".md");
          const blockerIndex = startedArchiveIds.length;
          startedArchiveIds.push(archiveId);
          await archiveRenames[blockerIndex].promise;
        }

        return baseFs.rawFs.rename(oldPath, newPath);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });
    const tasks = taskList.list("planning");

    const firstArchive = tasks.fire("foo", "archive");
    const secondArchive = tasks.fire("bar", "archive");

    await waitForCondition(() => startedArchiveIds.length === 1);
    expect(startedArchiveIds).toEqual(["foo"]);

    archiveRenames[0].resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(25);
    await waitForCondition(() => startedArchiveIds.length === 2);
    expect(startedArchiveIds).toEqual(["foo", "bar"]);

    archiveRenames[1].resolve();
    await Promise.all([firstArchive, secondArchive]);

    await expect(markdownEntries(baseFs.rawFs, "/repo/tasks/planning")).resolves.toEqual([
      "01-baz.md",
      "02-qux.md"
    ]);
    await expect(markdownEntries(baseFs.rawFs, "/repo/tasks/planning/archive")).resolves.toEqual([
      "bar.md",
      "foo.md"
    ]);
  });

  it("does not contend for updates to different task paths", async () => {
    const baseFs = createFs({
      "/repo/tasks/.keep": ""
    });
    const blockedPaths = new Map([
      ["/repo/tasks/alpha/01-one.md", createDeferred()],
      ["/repo/tasks/beta/01-two.md", createDeferred()]
    ]);
    const startedPaths: string[] = [];
    const fs: TaskListFs = {
      ...baseFs.fs,
      readFile: async (path, encoding) => {
        const blocker = blockedPaths.get(path);
        if (blocker) {
          startedPaths.push(path);
          await blocker.promise;
        }

        return baseFs.rawFs.readFile(path, encoding);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });

    await taskList.list("alpha").create({
      id: "one",
      name: "Alpha one"
    });
    await taskList.list("beta").create({
      id: "two",
      name: "Beta two"
    });

    const alphaUpdate = taskList.list("alpha").update("one", {
      metadata: {
        owner: "alpha"
      }
    });
    const betaUpdate = taskList.list("beta").update("two", {
      metadata: {
        owner: "beta"
      }
    });

    await waitForCondition(() => startedPaths.length === 2);

    expect([...startedPaths].sort()).toEqual([
      "/repo/tasks/alpha/01-one.md",
      "/repo/tasks/beta/01-two.md"
    ]);

    blockedPaths.get("/repo/tasks/alpha/01-one.md")?.resolve();
    blockedPaths.get("/repo/tasks/beta/01-two.md")?.resolve();

    await Promise.all([alphaUpdate, betaUpdate]);
  });
});
