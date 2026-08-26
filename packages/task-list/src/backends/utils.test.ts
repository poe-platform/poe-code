import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskListFs } from "../types.js";
import { createFs } from "./test-helpers.js";
import {
  applyOrder,
  compareCreated,
  hasErrorCode,
  statIfExists,
  withFileLock,
  writeAtomically,
  type OrderedEntry
} from "./utils.js";

function orderedEntry(qualifiedId: string, created: unknown): OrderedEntry {
  const [list, id] = qualifiedId.split("/");
  return {
    task: { list, id, qualifiedId, name: id, state: "draft", description: "", metadata: {} },
    raw: created === undefined ? {} : { created }
  };
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

describe("backend utilities", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("created order", () => {
    it.each([
      ["offsets", "2026-01-01T12:00:00Z", "2026-01-01T10:00:00-05:00", -1],
      ["mixed fractions", "2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.11Z", -1],
      ["whole seconds", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.1Z", -1],
      ["equivalent offsets", "2026-01-01T12:00:00Z", "2026-01-01T07:00:00-05:00", 0],
      ["equivalent fractions", "2026-01-01T00:00:00.1Z", "2026-01-01T00:00:00.100Z", 0]
    ] as const)("compares %s by instant with stable ties", (_name, leftCreated, rightCreated, sign) => {
      const left = orderedEntry("planning/zulu", leftCreated);
      const right = orderedEntry("planning/alpha", rightCreated);

      expect(Math.sign(compareCreated(left, right))).toBe(sign);
      expect(Math.sign(compareCreated(right, left)) + sign).toBe(0);
      expect(applyOrder([left, right], "created")).toEqual([left.task, right.task]);
      expect(applyOrder([right, left], "created")).toEqual(
        sign === 0 ? [right.task, left.task] : [left.task, right.task]
      );
    });

    it("orders valid, invalid, and missing categories transitively", () => {
      const entries = [
        orderedEntry("planning/later-id", "2026-01-01T12:00:00Z"),
        orderedEntry("planning/earlier-id", "2026-01-01T10:00:00-05:00"),
        orderedEntry("planning/invalid-space", " "),
        orderedEntry("planning/invalid-first", "!invalid"),
        orderedEntry("planning/invalid-between", "2026-01-01T11:00:00-invalid"),
        orderedEntry("planning/invalid-last", "z-invalid"),
        orderedEntry("alpha/zulu", undefined),
        orderedEntry("bravo/alpha", ""),
        orderedEntry("charlie/null", null),
        orderedEntry("delta/number", 123),
        orderedEntry("echo/boolean", false),
        orderedEntry("foxtrot/object", {}),
        orderedEntry("golf/array", [])
      ];

      for (const [leftIndex, left] of entries.entries()) {
        for (const [rightIndex, right] of entries.entries()) {
          expect(Math.sign(compareCreated(left, right))).toBe(Math.sign(leftIndex - rightIndex));
        }
      }
      expect(compareCreated(entries[3], orderedEntry("planning/other", "!invalid"))).toBe(0);
      expect(applyOrder([...entries].reverse(), "created")).toEqual(entries.map((entry) => entry.task));
    });

    it("leaves default, priority, and alphabetical ordering unchanged", () => {
      const entries = [
        orderedEntry("planning/zulu", "2026-01-02T00:00:00Z"),
        orderedEntry("planning/alpha", "2026-01-01T00:00:00Z")
      ];
      const tasks = entries.map((entry) => entry.task);

      expect(applyOrder(entries, undefined)).toEqual(tasks);
      expect(applyOrder(entries, "priority")).toEqual(tasks);
      expect(applyOrder(entries, "alphabetical")).toEqual([...tasks].reverse());
      expect(applyOrder(entries, "created")).toEqual([...tasks].reverse());
      expect(entries.map((entry) => entry.task)).toEqual(tasks);
    });
  });

  it("does not match inherited filesystem error codes", async () => {
    await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
      expect(hasErrorCode(new Error("permission denied"), "ENOENT")).toBe(false);
    });
  });

  it("does not hide stat errors with inherited missing-file codes", async () => {
    const { rawFs } = createFs({});
    const fs = {
      ...rawFs,
      stat: vi.fn(async () => {
        throw new Error("task stat denied");
      })
    } as TaskListFs;

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(statIfExists(fs, "/repo/tasks.yaml")).rejects.toThrow("task stat denied");
    });
  });

  it("does not remove a colliding atomic write temp symlink", async () => {
    const { rawFs, volume } = createFs({
      "/outside.tmp": "outside-state\n"
    });
    let tempPath: string | undefined;
    const fs = {
      ...rawFs,
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        const pathText = String(filePath);
        if (pathText.startsWith("/repo/tasks.yaml.") && pathText.endsWith(".tmp")) {
          tempPath = pathText;
          volume.symlinkSync("/outside.tmp", pathText);
          expect(options).toEqual({ encoding: "utf8", flag: "wx" });
        }

        return rawFs.writeFile(filePath, data, options);
      }
    } as TaskListFs;

    await expect(writeAtomically(fs, "/repo/tasks.yaml", "new state\n")).rejects.toThrow();

    expect(tempPath).toBeDefined();
    expect(volume.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
    await expect(rawFs.readFile("/repo/tasks.yaml", "utf8")).rejects.toThrow();
  });

  it("removes a partial atomic write temp file when the temp write fails", async () => {
    const { rawFs } = createFs({
      "/repo/tasks.yaml": "old state\n"
    });
    let tempPath: string | undefined;
    const fs = {
      ...rawFs,
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        const pathText = String(filePath);
        if (pathText.startsWith("/repo/tasks.yaml.") && pathText.endsWith(".tmp")) {
          tempPath = pathText;
          await rawFs.writeFile(filePath, "partial\n", options);
          throw new Error("task list disk full");
        }

        return rawFs.writeFile(filePath, data, options);
      }
    } as TaskListFs;

    await expect(writeAtomically(fs, "/repo/tasks.yaml", "new state\n")).rejects.toThrow(
      "task list disk full"
    );

    expect(tempPath).toBeDefined();
    await expect(rawFs.readFile(tempPath as string, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(rawFs.readFile("/repo/tasks.yaml", "utf8")).resolves.toBe("old state\n");
  });

  it.each(["EACCES", "ENOSPC", undefined])("preserves a foreign lock when acquisition fails with %s", async (code) => {
    const { rawFs } = createFs({});
    const lockPath = "/repo/tasks.yaml.lock";
    const failure = Object.assign(new Error("lock creation failed"), { code });
    const operation = vi.fn();
    const fs = {
      ...rawFs,
      async mkdir(filePath: string, options?: { recursive?: boolean }) {
        if (filePath === lockPath) {
          await rawFs.mkdir(lockPath);
          await rawFs.writeFile(`${lockPath}/foreign`, "owner");
          throw failure;
        }
        return rawFs.mkdir(filePath, options);
      },
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        if (String(filePath) === lockPath) {
          await rawFs.writeFile(filePath, "foreign owner", options);
          throw failure;
        }

        return rawFs.writeFile(filePath, data, options);
      }
    } as TaskListFs;

    await expect(withFileLock(fs, lockPath, operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
    expect((await rawFs.stat(lockPath)).isDirectory()).toBe(true);
    await expect(rawFs.readFile(`${lockPath}/foreign`, "utf8")).resolves.toBe("owner");
  });

  it.each(["", "not-a-pid", "2147483647", String(process.pid)])("fails closed on legacy lock content %j with actionable recovery", async (content) => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not running"), { code: "ESRCH" });
    });
    const lockPath = "/repo/tasks.yaml.lock";
    const { fs, rawFs } = createFs({ [lockPath]: content });
    const operation = vi.fn();
    const result = withFileLock(fs, lockPath, operation).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual(expect.objectContaining({
      message: expect.stringContaining(`Timed out waiting for task-list lock: ${lockPath}`)
    }));
    expect((await result as Error).message).toContain("only be removed after confirming all task-list operations have stopped");
    expect(operation).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    await expect(rawFs.readFile(lockPath, "utf8")).resolves.toBe(content);
  });
});
