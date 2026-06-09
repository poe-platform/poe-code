import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { MalformedTaskError } from "../types.js";
import { markdownDirBackend } from "./markdown-dir.js";
import { createDeferred, createFs, waitForCondition } from "./test-helpers.js";

const PIPELINE_SCHEMA_ID =
  "https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json";

function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  const closingIndex = lines.indexOf("---", 1);

  if (closingIndex === -1) {
    throw new Error("Missing frontmatter terminator.");
  }

  const document = parseDocument(lines.slice(1, closingIndex).join("\n"));

  return document.toJS() as Record<string, unknown>;
}

async function readSortedDirectory(rawFs: ReturnType<typeof createFs>["rawFs"], directory: string) {
  return (await rawFs.readdir(directory)).sort();
}

function ownProtoMetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "__proto__", {
    value: { reviewer: "security" },
    enumerable: true,
    writable: true,
    configurable: true
  });
  return metadata;
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

  it("sets an absolute sourcePath when reading tasks", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/01-source-path.md": `---
name: Source path
state: draft
---

Body`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    const task = await taskList.list("planning").get("source-path");
    const [listedTask] = await taskList.list("planning").all();

    expect(task.sourcePath).toBe("/repo/tasks/planning/01-source-path.md");
    expect(path.isAbsolute(task.sourcePath ?? "")).toBe(true);
    expect(listedTask?.sourcePath).toBe(task.sourcePath);
  });

  it("preserves proto-named frontmatter as own task metadata", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/proto.md": `---
name: Prototype task
state: draft
__proto__:
  owner: attacker
---

Body`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });

    const task = await taskList.list("planning").get("proto");

    expect(Object.hasOwn(task.metadata, "__proto__")).toBe(true);
    expect(task.metadata.__proto__).toEqual({ owner: "attacker" });
    expect((task.metadata as { owner?: string }).owner).toBeUndefined();
  });

  it("does not accept inherited task state fields", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/inherited.md": `---
name: Inherited
---

Body`
    });

    Object.defineProperty(Object.prototype, "state", {
      value: "draft",
      configurable: true
    });
    try {
      const taskList = await markdownDirBackend({
        path: "/repo/tasks",
        defaults: { metadata: {} },
        create: false,
        fs
      });

      await expect(taskList.list("planning").get("inherited")).rejects.toThrow(
        new MalformedTaskError('Malformed task "/repo/tasks/planning/inherited.md": invalid "state".')
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).state;
    }
  });

  it("preserves proto-named metadata through create, update, and fire", async () => {
    const { fs } = createFs();
    const taskList = await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      create: true,
      fs
    });
    const tasks = taskList.list("planning");

    await tasks.create({ id: "create", name: "Create", metadata: ownProtoMetadata() });
    await tasks.create({ id: "update", name: "Update" });
    await tasks.update("update", { metadata: ownProtoMetadata() });
    await tasks.create({ id: "fire", name: "Fire" });
    await tasks.fire("fire", "plan", { metadataPatch: ownProtoMetadata() });

    for (const id of ["create", "update", "fire"]) {
      const task = await tasks.get(id);
      expect(Object.hasOwn(task.metadata, "__proto__")).toBe(true);
      expect(task.metadata.__proto__).toEqual({ reviewer: "security" });
    }
  });

  it("rejects task operations through a symlinked list directory", async () => {
    const { fs, rawFs, volume } = createFs({
      "/outside/01-external.md": `---
name: External
state: draft
---

Outside`
    });
    volume.mkdirSync("/repo/tasks", { recursive: true });
    volume.symlinkSync("/outside", "/repo/tasks/planning");
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });
    const tasks = taskList.list("planning");

    await expect(tasks.get("external")).rejects.toThrow("symbolic link");
    await expect(tasks.create({ id: "local", name: "Local" })).rejects.toThrow("symbolic link");
    await expect(tasks.delete("external")).rejects.toThrow("symbolic link");
    await expect(rawFs.readdir("/outside")).resolves.toEqual(["01-external.md"]);
  });

  it("rejects archived task operations through a symlinked archive directory", async () => {
    const { fs, rawFs, volume } = createFs({
      "/repo/tasks/planning/01-active.md": `---
name: Active
state: draft
---

Active`,
      "/outside/external.md": `---
name: External
state: archived
---

Outside`
    });
    volume.symlinkSync("/outside", "/repo/tasks/planning/archive");
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });
    const tasks = taskList.list("planning");

    await expect(tasks.get("external")).rejects.toThrow("symbolic link");
    await expect(tasks.fire("active", "archive")).rejects.toThrow("symbolic link");
    await expect(tasks.delete("external")).rejects.toThrow("symbolic link");
    await expect(rawFs.readdir("/outside")).resolves.toEqual(["external.md"]);
  });

  it("rejects reading a symlinked markdown task file", async () => {
    const { fs, volume } = createFs({
      "/outside/external.md": `---
name: External
state: draft
---

Outside`
    });
    volume.mkdirSync("/repo/tasks/planning", { recursive: true });
    volume.symlinkSync("/outside/external.md", "/repo/tasks/planning/01-linked.md");
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });

    await expect(taskList.list("planning").get("linked")).rejects.toThrow("symbolic link");
    await expect(taskList.list("planning").all()).rejects.toThrow("symbolic link");
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

  it("rejects non-task frontmatter in strict mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/pipeline.md": `---
kind: pipeline
version: 1
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
      create: false,
      fs
    });

    await expect(taskList.list("planning").get("pipeline")).rejects.toBeInstanceOf(
      MalformedTaskError
    );
    await expect(taskList.list("planning").get("pipeline")).rejects.toThrow('"kind"');
  });

  it("ignores hidden entries and the reserved archive directory at the root", async () => {
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
      "/repo/tasks/readme.txt": "not a list"
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.lists()).resolves.toEqual(["alpha"]);
  });

  it("reads the root directory as the only list in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": `---
name: Foo
state: draft
---
`,
      "/repo/tasks/01-bar.md": `---
name: Bar
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.lists()).resolves.toEqual(["plans"]);
    await expect(taskList.list("plans").all()).resolves.toMatchObject([
      {
        id: "bar",
        qualifiedId: "plans/bar",
        name: "Bar"
      },
      {
        id: "foo",
        qualifiedId: "plans/foo",
        name: "Foo"
      }
    ]);
  });

  it("reads non-task frontmatter as metadata in single-list passthrough mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
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
      create: false,
      fs
    });

    await expect(taskList.list("plans").get("foo")).resolves.toMatchObject({
      id: "foo",
      name: "foo",
      state: "draft",
      description: "",
      metadata: {
        $schema: PIPELINE_SCHEMA_ID,
        kind: "pipeline",
        version: 1
      }
    });
  });

  it("synthesizes passthrough task fields from numbered filenames and the state machine", async () => {
    const { fs } = createFs({
      "/repo/tasks/07-foo.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
kind: pipeline
version: 1
name: 123
state: unknown
description: Frontmatter description is ignored
---

Body description`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.list("plans").get("foo")).resolves.toEqual({
      id: "foo",
      list: "plans",
      qualifiedId: "plans/foo",
      name: "foo",
      state: "draft",
      description: "Body description",
      sourcePath: "/repo/tasks/07-foo.md",
      metadata: {
        $schema: PIPELINE_SCHEMA_ID,
        kind: "pipeline",
        version: 1
      }
    });
  });

  it("reads empty frontmatter with passthrough defaults", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": `---
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
      create: false,
      fs
    });

    await expect(taskList.list("plans").get("foo")).resolves.toMatchObject({
      id: "foo",
      name: "foo",
      state: "draft",
      description: "",
      metadata: {}
    });
  });

  it("reads a file with no frontmatter block as a passthrough task with empty metadata", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": `# Heading

Body paragraph.
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      frontmatterMode: "passthrough",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.list("plans").get("foo")).resolves.toMatchObject({
      id: "foo",
      name: "foo",
      state: "draft",
      description: "# Heading\n\nBody paragraph.\n",
      metadata: {}
    });
  });

  it("preserves non-task frontmatter keys when firing passthrough tasks", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/foo.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
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
      create: false,
      fs
    });

    await taskList.list("plans").fire("foo", "plan");

    const content = await rawFs.readFile("/repo/tasks/foo.md", "utf8");
    expect(parseFrontmatter(content)).toMatchObject({
      $schema: PIPELINE_SCHEMA_ID,
      kind: "pipeline",
      version: 1,
      name: "foo",
      state: "planned"
    });
  });

  it("applies passthrough metadata patches without injecting task envelope keys", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/foo.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
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
      create: false,
      fs
    });

    await taskList.list("plans").update("foo", {
      name: "Updated plan",
      metadata: {
        $schema: "https://example.test/custom.schema.json",
        kind: "pipeline-v2",
        owner: "kj",
        version: 2
      }
    });

    const frontmatter = parseFrontmatter(await rawFs.readFile("/repo/tasks/foo.md", "utf8"));

    expect(frontmatter).toMatchObject({
      $schema: "https://example.test/custom.schema.json",
      kind: "pipeline-v2",
      name: "Updated plan",
      owner: "kj",
      state: "draft",
      version: 2
    });
    expect(frontmatter).not.toMatchObject({
      $schema: "https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json",
      kind: "task"
    });
  });

  it("rejects other list names in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    expect(() => taskList.list("other")).toThrow('Task list "other" not found.');
  });

  it("does not move between lists in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": `---
name: Foo
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.moveBetweenLists("plans/foo", "plans")).rejects.toThrow(
      "moveBetweenLists is unsupported in single-list mode."
    );
    await expect(taskList.moveBetweenLists("not-a-qualified-id", "other")).rejects.toThrow(
      "moveBetweenLists is unsupported in single-list mode."
    );
  });

  it("ignores root subdirectories when reading active tasks in single-list mode", async () => {
    const { fs } = createFs({
      "/repo/tasks/foo.md": `---
name: Foo
state: draft
---
`,
      "/repo/tasks/poe-agent/ignored.md": `---
name: Ignored
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.list("plans").all()).resolves.toHaveLength(1);
    await expect(taskList.list("plans").all()).resolves.toMatchObject([
      {
        id: "foo",
        name: "Foo"
      }
    ]);
  });

  it("creates and archives tasks at the root in single-list mode", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/.keep": ""
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      singleList: "plans",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await taskList.list("plans").create({
      id: "root-task",
      name: "Root task"
    });

    await expect(rawFs.readFile("/repo/tasks/01-root-task.md", "utf8")).resolves.toContain(
      "name: Root task"
    );
    await expect(rawFs.stat("/repo/tasks/plans")).rejects.toMatchObject({
      code: "ENOENT"
    });

    await taskList.list("plans").fire("root-task", "archive");

    await expect(rawFs.stat("/repo/tasks/01-root-task.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(rawFs.readFile("/repo/tasks/archive/root-task.md", "utf8")).resolves.toContain(
      "state: archived"
    );
    await expect(taskList.list("plans").all({ includeArchived: true })).resolves.toMatchObject([
      {
        id: "root-task",
        qualifiedId: "plans/root-task",
        state: "archived"
      }
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

  it("preserves active prefixes after archiving a task in multi-list mode", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/01-foo.md": `---
name: Foo
state: draft
---
`,
      "/repo/tasks/planning/02-bar.md": `---
name: Bar
state: draft
---
`,
      "/repo/tasks/planning/03-baz.md": `---
name: Baz
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await taskList.list("planning").fire("bar", "archive");

    await expect(readSortedDirectory(rawFs, "/repo/tasks/planning")).resolves.toEqual([
      "01-foo.md",
      "03-baz.md",
      "archive"
    ]);
    await expect(readSortedDirectory(rawFs, "/repo/tasks/planning/archive")).resolves.toEqual([
      "bar.md"
    ]);
  });

  it("preserves root prefixes after archiving a task in single-list passthrough mode", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/01-foo.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
kind: pipeline
version: 1
---
`,
      "/repo/tasks/02-bar.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
kind: pipeline
version: 1
---
`,
      "/repo/tasks/03-baz.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
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
      create: false,
      fs
    });

    await taskList.list("plans").fire("bar", "archive");

    await expect(readSortedDirectory(rawFs, "/repo/tasks")).resolves.toEqual([
      "01-foo.md",
      "03-baz.md",
      "archive"
    ]);
    await expect(readSortedDirectory(rawFs, "/repo/tasks/archive")).resolves.toEqual(["bar.md"]);
  });

  it("assigns the next prefix after the highest active prefix when archiving leaves a gap", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/01-foo.md": `---
name: Foo
state: draft
---
`,
      "/repo/tasks/planning/02-bar.md": `---
name: Bar
state: draft
---
`,
      "/repo/tasks/planning/03-baz.md": `---
name: Baz
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await taskList.list("planning").fire("bar", "archive");
    await taskList.list("planning").create({ id: "qux", name: "Qux" });

    await expect(readSortedDirectory(rawFs, "/repo/tasks/planning")).resolves.toEqual([
      "01-foo.md",
      "03-baz.md",
      "04-qux.md",
      "archive"
    ]);
  });

  it("renumbers only the moved task when moving it after a prefix gap", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/01-alpha.md": `---
name: Alpha
state: draft
---
`,
      "/repo/tasks/planning/02-bravo.md": `---
name: Bravo
state: draft
---
`,
      "/repo/tasks/planning/03-charlie.md": `---
name: Charlie
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await taskList.list("planning").fire("bravo", "archive");
    await taskList.list("planning").move("alpha", { position: "bottom" });

    await expect(readSortedDirectory(rawFs, "/repo/tasks/planning")).resolves.toEqual([
      "03-charlie.md",
      "04-alpha.md",
      "archive"
    ]);
  });

  it("archives the only task without leaving active markdown files", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/01-only.md": `---
name: Only
state: draft
---
`
    });
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await taskList.list("planning").fire("only", "archive");

    await expect(readSortedDirectory(rawFs, "/repo/tasks/planning")).resolves.toEqual(["archive"]);
    await expect(readSortedDirectory(rawFs, "/repo/tasks/planning/archive")).resolves.toEqual([
      "only.md"
    ]);
  });

  it("archives the only root task in single-list mode without leaving root markdown files", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks/01-only.md": `---
$schema: ${PIPELINE_SCHEMA_ID}
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
      create: false,
      fs
    });

    await taskList.list("plans").fire("only", "archive");

    await expect(readSortedDirectory(rawFs, "/repo/tasks")).resolves.toEqual(["archive"]);
    await expect(readSortedDirectory(rawFs, "/repo/tasks/archive")).resolves.toEqual(["only.md"]);
  });

  it("does not commit archived state when archive relocation fails", async () => {
    const storage = createFs({ "/repo/tasks/.keep": "" });
    const fs: TaskListFs = {
      ...storage.fs,
      rename: async (fromPath, toPath) => {
        if (toPath === "/repo/tasks/planning/archive/ship.md") {
          throw new Error("archive relocation failed");
        }
        await storage.fs.rename(fromPath, toPath);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });
    const tasks = taskList.list("planning");
    await tasks.create({ id: "ship", name: "Ship" });

    await expect(tasks.fire("ship", "archive")).rejects.toThrow("archive relocation failed");
    await expect(tasks.get("ship")).resolves.toMatchObject({ state: "draft" });
    await expect(storage.rawFs.readFile("/repo/tasks/planning/01-ship.md", "utf8")).resolves.toContain(
      "state: draft"
    );
  });

  it("restores active task files when a reorder final rename fails", async () => {
    const storage = createFs({
      "/repo/tasks/planning/01-alpha.md": `---\nname: Alpha\nstate: draft\n---\n`,
      "/repo/tasks/planning/02-bravo.md": `---\nname: Bravo\nstate: draft\n---\n`,
      "/repo/tasks/planning/03-charlie.md": `---\nname: Charlie\nstate: draft\n---\n`
    });
    let finalized = 0;
    const fs: TaskListFs = {
      ...storage.fs,
      rename: async (fromPath, toPath) => {
        if (fromPath.includes(".staging-") && !toPath.includes(".staging-")) {
          finalized += 1;
          if (finalized === 2) {
            throw new Error("simulated rename failure");
          }
        }
        await storage.fs.rename(fromPath, toPath);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });

    await expect(taskList.list("planning").reorder(["charlie", "bravo", "alpha"])).rejects.toThrow(
      "simulated rename failure"
    );
    await expect(taskList.list("planning").all()).resolves.toMatchObject([
      { id: "alpha" },
      { id: "bravo" },
      { id: "charlie" }
    ]);
    await expect(readSortedDirectory(storage.rawFs, "/repo/tasks/planning")).resolves.toEqual([
      "01-alpha.md",
      "02-bravo.md",
      "03-charlie.md"
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

  it("does not reject a committed cross-list move due to a target read failure", async () => {
    const storage = createFs({
      "/repo/tasks/planning/01-shared.md": `---
name: Shared
state: draft
---

Valid body`,
      "/repo/tasks/doing/01-existing.md": `---
name: Existing
state: draft
---
`
    });
    let moved = false;
    const fs: TaskListFs = {
      ...storage.fs,
      rename: async (fromPath, toPath) => {
        await storage.fs.rename(fromPath, toPath);
        if (fromPath === "/repo/tasks/planning/01-shared.md") {
          moved = true;
        }
      },
      readFile: async (filePath, encoding) => {
        if (moved && filePath === "/repo/tasks/doing/02-shared.md") {
          throw new Error("simulated target read failure");
        }
        return storage.fs.readFile(filePath, encoding);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });

    await expect(taskList.moveBetweenLists("planning/shared", "doing")).resolves.toMatchObject({
      list: "doing",
      id: "shared",
      description: "Valid body"
    });
  });

  it("rejects a same-id create that races a committed cross-list move", async () => {
    const storage = createFs({ "/repo/tasks/.keep": "" });
    const moveAtRename = createDeferred();
    const releaseMove = createDeferred();
    let createOutcome = "pending";
    let holdMove = false;
    const fs: TaskListFs = {
      ...storage.fs,
      rename: async (fromPath, toPath) => {
        if (holdMove && fromPath === "/repo/tasks/planning/01-shared.md") {
          moveAtRename.resolve();
          await releaseMove.promise;
        }
        await storage.fs.rename(fromPath, toPath);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      create: false,
      fs
    });
    await taskList.list("planning").create({ id: "shared", name: "Moved source" });

    holdMove = true;
    const moved = taskList.moveBetweenLists("planning/shared", "doing");
    await moveAtRename.promise;
    const created = taskList.list("doing").create({ id: "shared", name: "Concurrent target" }).then(
      () => {
        createOutcome = "resolved";
      },
      () => {
        createOutcome = "rejected";
      }
    );
    await waitForCondition(() => createOutcome !== "pending").catch(() => undefined);

    releaseMove.resolve();
    await moved;
    await created;

    expect(createOutcome).toBe("rejected");
    await expect(taskList.list("doing").get("shared")).resolves.toMatchObject({ name: "Moved source" });
  });
});
