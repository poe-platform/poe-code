import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { MalformedTaskError } from "../types.js";
import { yamlFileBackend } from "./yaml-file.js";
import { createFs } from "./test-helpers.js";

function parseYaml(content: string): Record<string, unknown> {
  const document = parseDocument(content);

  return document.toJS() as Record<string, unknown>;
}

describe("yamlFileBackend", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("initializes the store file only when create is true", async () => {
    const missingStore = createFs();

    await expect(
      openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml",
        fs: missingStore.fs
      })
    ).rejects.toMatchObject({
      code: "ENOENT"
    });

    await expect(
      openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml",
        create: true,
        fs: missingStore.fs
      })
    ).resolves.toBeDefined();

    await expect(missingStore.rawFs.readFile("/repo/tasks.yaml", "utf8")).resolves.toContain(
      "kind: task-store"
    );
    expect(parseYaml(await missingStore.rawFs.readFile("/repo/tasks.yaml", "utf8"))).toEqual({
      $schema: "https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
      kind: "task-store",
      version: 1,
      lists: {}
    });
  });

  it("does not overwrite an existing store when create is true", async () => {
    const existingStore = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "commentary:",
        "  owner: kj",
        "lists:",
        "  planning: {}",
        ""
      ].join("\n")
    });
    const before = await existingStore.rawFs.readFile("/repo/tasks.yaml", "utf8");

    await expect(
      openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml",
        create: true,
        fs: existingStore.fs
      })
    ).resolves.toBeDefined();

    await expect(existingStore.rawFs.readFile("/repo/tasks.yaml", "utf8")).resolves.toBe(before);
  });

  it("preserves unknown top-level keys during updates", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "commentary:",
        "  owner: kj",
        "lists:",
        "  planning:",
        "    custom:",
        "      name: Custom task",
        "      state: draft",
        "      estimate: 3",
        "      description: Initial body",
        ""
      ].join("\n")
    });
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
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

    expect(parseYaml(await rawFs.readFile("/repo/tasks.yaml", "utf8"))).toMatchObject({
      commentary: {
        owner: "kj"
      },
      lists: {
        planning: {
          custom: {
            name: "Updated custom",
            owner: "pm",
            estimate: 3
          }
        }
      }
    });
  });

  it("does not resolve inherited task IDs from list records", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning: {}",
        ""
      ].join("\n")
    });
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: { metadata: {} },
      create: false,
      fs
    });
    const tasks = taskList.list("planning");

    await expect(tasks.get("__proto__")).rejects.toThrow('Task "planning/__proto__" not found.');
    await expect(tasks.create({ id: "__proto__", name: "Proto" })).resolves.toMatchObject({
      id: "__proto__"
    });
  });

  it("sets an absolute sourcePath when reading tasks", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    source-path:",
        "      name: Source path",
        "      state: draft",
        "      description: Body",
        ""
      ].join("\n")
    });
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    const task = await taskList.list("planning").get("source-path");
    const [listedTask] = await taskList.list("planning").all();

    expect(task.sourcePath).toBe("/repo/tasks.yaml");
    expect(path.isAbsolute(task.sourcePath ?? "")).toBe(true);
    expect(listedTask?.sourcePath).toBe(task.sourcePath);
  });

  it("throws MalformedTaskError naming the invalid list and id", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  alpha:",
        "    bad:",
        "      name: Broken task",
        "      state: not-a-real-state",
        "      description: Broken",
        ""
      ].join("\n")
    });
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.list("alpha").get("bad")).rejects.toEqual(
      expect.objectContaining({
        name: "MalformedTaskError",
        message: expect.stringContaining("alpha/bad")
      })
    );
    await expect(taskList.list("alpha").get("bad")).rejects.toThrow('"state"');
    await expect(taskList.list("alpha").get("bad")).rejects.toBeInstanceOf(MalformedTaskError);
  });

  it("throws MalformedTaskError for an invalid store envelope", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists: nope",
        ""
      ].join("\n")
    });
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: {
        metadata: {}
      },
      create: false,
      fs
    });

    await expect(taskList.lists()).rejects.toEqual(
      expect.objectContaining({
        name: "MalformedTaskError",
        message: expect.stringContaining('/repo/tasks.yaml": invalid "lists"')
      })
    );
  });
});
