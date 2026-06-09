import { describe, expect, it, vi } from "vitest";
import type { TaskListFs } from "../types.js";
import { createFs } from "./test-helpers.js";
import { hasErrorCode, statIfExists, withFileLock, writeAtomically } from "./utils.js";

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

  it("removes a partial lock file when lock creation fails", async () => {
    const { rawFs } = createFs({});
    const lockPath = "/repo/tasks.yaml.lock";
    const fs = {
      ...rawFs,
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        if (String(filePath) === lockPath) {
          await rawFs.writeFile(filePath, "partial-lock", options);
          throw new Error("lock disk full");
        }

        return rawFs.writeFile(filePath, data, options);
      }
    } as TaskListFs;

    await expect(withFileLock(fs, lockPath, async () => undefined)).rejects.toThrow(
      "lock disk full"
    );
    await expect(rawFs.readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
