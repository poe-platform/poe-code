import path from "node:path";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { MalformedTaskError, TaskNotFoundError } from "../types.js";
import { yamlFileBackend } from "./yaml-file.js";
import { createFs } from "./test-helpers.js";

function parseYaml(content: string): Record<string, unknown> {
  const document = parseDocument(content);

  return document.toJS() as Record<string, unknown>;
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

  it("rejects stores that only inherit required top-level fields", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": "{}\n"
    });

    await withObjectPrototypeProperties(
      {
        $schema: "https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        kind: "task-store",
        version: 1,
        lists: {}
      },
      async () => {
        const taskList = await yamlFileBackend({
          path: "/repo/tasks.yaml",
          defaults: { metadata: {} },
          create: false,
          fs
        });

        await expect(taskList.lists()).rejects.toBeInstanceOf(MalformedTaskError);
      }
    );
  });

  it("ignores inherited list records", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists: {}",
        ""
      ].join("\n")
    });

    await withObjectPrototypeProperties(
      {
        planning: {
          polluted: {
            name: "Polluted",
            state: "draft"
          }
        }
      },
      async () => {
        const taskList = await yamlFileBackend({
          path: "/repo/tasks.yaml",
          defaults: { metadata: {} },
          create: false,
          fs
        });

        await expect(taskList.lists()).resolves.toEqual([]);
        await expect(taskList.list("planning").get("polluted")).rejects.toBeInstanceOf(
          TaskNotFoundError
        );
      }
    );
  });

  it("ignores inherited optional task descriptions", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    ship:",
        "      name: Ship it",
        "      state: draft",
        ""
      ].join("\n")
    });

    await withObjectPrototypeProperties({ description: "Polluted description" }, async () => {
      const taskList = await yamlFileBackend({
        path: "/repo/tasks.yaml",
        defaults: { metadata: {} },
        create: false,
        fs
      });

      await expect(taskList.list("planning").get("ship")).resolves.toMatchObject({
        description: ""
      });
    });
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

  it("preserves proto-named metadata as own task metadata values", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    stored:",
        "      name: Stored",
        "      state: draft",
        "      __proto__:",
        "        reviewer: security",
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
    const protoMetadata = Object.fromEntries([["__proto__", { reviewer: "security" }]]);

    const stored = await tasks.get("stored");
    const created = await tasks.create({ id: "created", name: "Created", metadata: protoMetadata });
    const updated = await tasks.update("created", { metadata: protoMetadata });
    const fired = await tasks.fire("created", "plan", { metadataPatch: protoMetadata });

    for (const task of [stored, created, updated, fired]) {
      expect(Object.hasOwn(task.metadata, "__proto__")).toBe(true);
      expect(task.metadata.__proto__).toEqual({ reviewer: "security" });
      expect(Object.getPrototypeOf(task.metadata)).toBeNull();
    }
    await expect(rawFs.readFile("/repo/tasks.yaml", "utf8")).resolves.toContain("__proto__:");
  });

  it("does not accept inherited task state fields", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    inherited:",
        "      name: Inherited",
        ""
      ].join("\n")
    });

    Object.defineProperty(Object.prototype, "state", {
      value: "draft",
      configurable: true
    });
    try {
      const taskList = await yamlFileBackend({
        path: "/repo/tasks.yaml",
        defaults: { metadata: {} },
        create: false,
        fs
      });

      await expect(taskList.list("planning").get("inherited")).rejects.toThrow(
        new MalformedTaskError('Malformed task "planning/inherited": invalid "state".')
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).state;
    }
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

  it("rejects reads and writes through a symlinked yaml store path", async () => {
    const { fs, rawFs, volume } = createFs({
      "/outside/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    external:",
        "      name: External",
        "      state: draft",
        ""
      ].join("\n")
    });
    volume.mkdirSync("/repo", { recursive: true });
    volume.symlinkSync("/outside/tasks.yaml", "/repo/tasks.yaml");
    await expect(
      yamlFileBackend({
        path: "/repo/tasks.yaml",
        defaults: { metadata: {} },
        create: false,
        fs
      })
    ).rejects.toThrow(
      "symbolic link"
    );
    await expect(rawFs.readFile("/outside/tasks.yaml", "utf8")).resolves.not.toContain("local:");
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
