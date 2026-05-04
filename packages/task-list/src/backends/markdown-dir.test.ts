import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { MalformedTaskError } from "../types.js";
import { markdownDirBackend } from "./markdown-dir.js";
import { createDeferred, createFs, waitForCondition } from "./test-helpers.js";

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
