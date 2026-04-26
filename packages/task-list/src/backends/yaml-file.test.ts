import { parseDocument } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { MalformedTaskError } from "../types.js";
import { yamlFileBackend } from "./yaml-file.js";
import { createDeferred, createFs, flushMicrotasks, waitForCondition } from "./test-helpers.js";

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
      lockStaleMs: 30_000,
      lockRetries: 20,
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
      lockStaleMs: 30_000,
      lockRetries: 20,
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

  it("serializes concurrent updates across different lists with the whole-file lock", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const baseFs = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  alpha:",
        "    one:",
        "      name: Alpha one",
        "      state: draft",
        "      description: ''",
        "  beta:",
        "    two:",
        "      name: Beta two",
        "      state: draft",
        "      description: ''",
        ""
      ].join("\n")
    });
    const reads = [createDeferred(), createDeferred()];
    let activeReads = 0;
    let readCount = 0;
    let armReadBlockers = false;
    const fs: TaskListFs = {
      ...baseFs.fs,
      readFile: async (path, encoding) => {
        if (armReadBlockers && path === "/repo/tasks.yaml" && readCount < reads.length) {
          const currentRead = readCount;
          readCount += 1;
          activeReads += 1;

          try {
            await reads[currentRead].promise;
          } finally {
            activeReads -= 1;
          }
        }

        return baseFs.rawFs.readFile(path, encoding);
      }
    };
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: {
        metadata: {}
      },
      lockStaleMs: 30_000,
      lockRetries: 5,
      create: false,
      fs
    });

    armReadBlockers = true;

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

    await waitForCondition(() => readCount === 1);
    expect(activeReads).toBe(1);

    reads[0].resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks();

    expect(readCount).toBe(2);
    expect(activeReads).toBe(1);

    reads[1].resolve();

    await Promise.all([alphaUpdate, betaUpdate]);

    await expect(taskList.get("alpha/one")).resolves.toMatchObject({
      metadata: {
        owner: "alpha"
      }
    });
    await expect(taskList.get("beta/two")).resolves.toMatchObject({
      metadata: {
        owner: "beta"
      }
    });
  });
});
