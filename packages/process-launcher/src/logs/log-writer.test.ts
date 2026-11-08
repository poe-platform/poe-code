import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { createLogWriter } from "./log-writer.js";
import { createLogWriter as createLogWriterFromIndex } from "../index.js";
import type { LauncherFileSystem } from "../types.js";

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

function createMemFs(): LauncherFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
}

function symlink(fs: LauncherFileSystem, target: string, linkPath: string): Promise<void> {
  return (
    fs as LauncherFileSystem & { symlink(target: string, path: string): Promise<void> }
  ).symlink(target, linkPath);
}

describe("createLogWriter", () => {
  it("is exported from the package entrypoint", () => {
    expect(createLogWriterFromIndex).toBe(createLogWriter);
  });

  it("write() creates log file and appends line", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("hello", "stdout");

    await expect(fs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("hello\n");
  });

  it("write() appends multiple lines", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("first", "stdout");
    await writer.write("second", "stdout");

    await expect(fs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("first\nsecond\n");
  });

  it("write() handles stdout and stderr separately", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("out", "stdout");
    await writer.write("err", "stderr");

    await expect(fs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("out\n");
    await expect(fs.readFile("/logs/stderr.log", "utf8")).resolves.toBe("err\n");
  });

  it("rejects logging through a symlinked log directory", async () => {
    const fs = createMemFs();
    await fs.mkdir("/project/logs", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await symlink(fs, "/outside", "/project/logs/linked");
    const writer = createLogWriter("/project/logs/linked", 1, fs);

    await expect(writer.write("external write", "stdout")).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/stdout.log", "utf8")).rejects.toThrow();
  });

  it("rejects writing through a symlinked current log file", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/stdout.log", "external\n");
    await symlink(fs, "/outside/stdout.log", "/logs/stdout.log");
    const writer = createLogWriter("/logs", 1, fs);

    await expect(writer.write("external write", "stdout")).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/stdout.log", "utf8")).resolves.toBe("external\n");
  });

  it("rejects tailing through a symlinked current log file", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/stdout.log", "external\n");
    await symlink(fs, "/outside/stdout.log", "/logs/stdout.log");
    const writer = createLogWriter("/logs", 1, fs);

    await expect(writer.tail("stdout")).rejects.toThrow("symbolic link");
  });

  it("rotate() shifts log files from current to .1", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("hello", "stdout");
    await writer.rotate();

    await expect(fs.readFile("/logs/stdout.1.log", "utf8")).resolves.toBe("hello\n");
    await expect(fs.readFile("/logs/stdout.log", "utf8")).rejects.toThrow();
  });

  it("rotate() shifts numbered files", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.writeFile("/logs/stdout.log", "current\n");
    await fs.writeFile("/logs/stdout.1.log", "previous\n");
    const writer = createLogWriter("/logs", 3, fs);

    await writer.rotate();

    await expect(fs.readFile("/logs/stdout.1.log", "utf8")).resolves.toBe("current\n");
    await expect(fs.readFile("/logs/stdout.2.log", "utf8")).resolves.toBe("previous\n");
  });

  it("rejects rotating through a symlinked current log file", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/outside/stdout.log", "external\n");
    await symlink(fs, "/outside/stdout.log", "/logs/stdout.log");
    const writer = createLogWriter("/logs", 1, fs);

    await expect(writer.rotate()).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/stdout.log", "utf8")).resolves.toBe("external\n");
  });

  it("rejects rotating into a symlinked retained log file", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile("/logs/stdout.log", "current\n");
    await fs.writeFile("/outside/stdout.1.log", "external\n");
    await symlink(fs, "/outside/stdout.1.log", "/logs/stdout.1.log");
    const writer = createLogWriter("/logs", 1, fs);

    await expect(writer.rotate()).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("current\n");
    await expect(fs.readFile("/outside/stdout.1.log", "utf8")).resolves.toBe("external\n");
  });

  it("serializes writes with rotation so concurrent appended lines are retained", async () => {
    const baseFs = createMemFs();
    let releaseRotation!: () => void;
    let copiedCurrent!: () => void;
    const copied = new Promise<void>((resolve) => {
      copiedCurrent = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    const fs: LauncherFileSystem = {
      ...baseFs,
      async rename(sourcePath, destinationPath) {
        await baseFs.rename(sourcePath, destinationPath);
        if (destinationPath === "/logs/stdout.1.log") {
          copiedCurrent();
          await gate;
        }
      },
      async appendFile(filePath, content) {
        await baseFs.appendFile(filePath, content);
      }
    };
    const writer = createLogWriter("/logs", 3, fs);
    await writer.write("old", "stdout");

    const rotating = writer.rotate();
    await copied;
    const writing = writer.write("late", "stdout");
    const outcomeBeforeRotationCompletes = await Promise.race([
      writing.then(() => "written"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 10))
    ]);
    expect(outcomeBeforeRotationCompletes).toBe("pending");
    releaseRotation();
    await Promise.all([rotating, writing]);

    await expect(fs.readFile("/logs/stdout.1.log", "utf8")).resolves.toBe("old\n");
    await expect(writer.tail("stdout")).resolves.toEqual(["late"]);
  });

  it("preserves prior retained logs if rotating the current log fails", async () => {
    const baseFs = createMemFs();
    await baseFs.mkdir("/logs", { recursive: true });
    await baseFs.writeFile("/logs/stdout.log", "current\n");
    await baseFs.writeFile("/logs/stdout.1.log", "retained\n");
    const fs: LauncherFileSystem = {
      ...baseFs,
      async rename(sourcePath, destinationPath) {
        if (sourcePath === "/logs/stdout.log" && destinationPath === "/logs/stdout.1.log") {
          throw new Error("injected rotation failure");
        }
        await baseFs.rename(sourcePath, destinationPath);
      }
    };

    await expect(createLogWriter("/logs", 1, fs).rotate()).rejects.toThrow(
      "injected rotation failure"
    );
    await expect(baseFs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("current\n");
    await expect(baseFs.readFile("/logs/stdout.1.log", "utf8")).resolves.toBe("retained\n");
  });

  it("preserves both streams when zero-retention cleanup cannot finish", async () => {
    const baseFs = createMemFs();
    await baseFs.mkdir("/logs", { recursive: true });
    await baseFs.writeFile("/logs/stdout.log", "stdout current\n");
    await baseFs.writeFile("/logs/stderr.log", "stderr current\n");
    const fs: LauncherFileSystem = {
      ...baseFs,
      async rm(filePath, options) {
        if (filePath === "/logs/stderr.log") {
          throw new Error("injected stderr removal failure");
        }
        await baseFs.rm(filePath, options);
      }
    };

    await expect(createLogWriter("/logs", 0, fs).rotate()).rejects.toThrow(
      "injected stderr removal failure"
    );
    await expect(baseFs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("stdout current\n");
    await expect(baseFs.readFile("/logs/stderr.log", "utf8")).resolves.toBe("stderr current\n");
  });

  it("rotate() deletes oldest file beyond retainCount", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.writeFile("/logs/stdout.log", "current\n");
    await fs.writeFile("/logs/stdout.1.log", "previous\n");
    await fs.writeFile("/logs/stdout.2.log", "oldest\n");
    const writer = createLogWriter("/logs", 2, fs);

    await writer.rotate();

    await expect(fs.readFile("/logs/stdout.1.log", "utf8")).resolves.toBe("current\n");
    await expect(fs.readFile("/logs/stdout.2.log", "utf8")).resolves.toBe("previous\n");
    await expect(fs.readFile("/logs/stdout.3.log", "utf8")).rejects.toThrow();
  });

  it("rotate() removes all retained history when retainCount is zero", async () => {
    const fs = createMemFs();
    await fs.mkdir("/logs", { recursive: true });
    await fs.writeFile("/logs/stdout.log", "current\n");
    await fs.writeFile("/logs/stdout.1.log", "previous\n");
    const writer = createLogWriter("/logs", 0, fs);

    await writer.rotate();

    await expect(fs.readFile("/logs/stdout.log", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/logs/stdout.1.log", "utf8")).rejects.toThrow();
  });

  it("rejects a non-finite retention count", () => {
    expect(() => createLogWriter("/logs", Number.POSITIVE_INFINITY, createMemFs())).toThrow(
      "retainCount must be a finite non-negative integer"
    );
  });

  it("rotate() is safe when no log files exist", async () => {
    const writer = createLogWriter("/logs", 3, createMemFs());

    await expect(writer.rotate()).resolves.toBeUndefined();
  });

  it("tail() returns last N lines", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("one", "stdout");
    await writer.write("two", "stdout");
    await writer.write("three", "stdout");

    await expect(writer.tail("stdout", 2)).resolves.toEqual(["two", "three"]);
  });

  it("tail() returns empty array for non-existent file", async () => {
    const writer = createLogWriter("/logs", 3, createMemFs());

    await expect(writer.tail("stdout", 10)).resolves.toEqual([]);
  });

  it("does not hide tail read errors with inherited missing codes", async () => {
    const baseFs = createMemFs();
    const fs = {
      ...baseFs,
      readFile: async (filePath: string, encoding: BufferEncoding) => {
        if (filePath === "/logs/stdout.log") {
          throw new Error("log read denied");
        }

        return await baseFs.readFile(filePath, encoding);
      }
    } as LauncherFileSystem;
    const writer = createLogWriter("/logs", 3, fs);

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(writer.tail("stdout", 10)).rejects.toThrow("log read denied");
    });
  });

  it("tail() defaults to 50 lines", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    for (let index = 1; index <= 60; index += 1) {
      await writer.write(`line-${index}`, "stdout");
    }

    await expect(writer.tail("stdout")).resolves.toEqual(
      Array.from({ length: 50 }, (_, offset) => `line-${offset + 11}`)
    );
  });

  it("tail() returns no lines when asked for zero", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("one", "stdout");
    await writer.write("two", "stdout");

    await expect(writer.tail("stdout", 0)).resolves.toEqual([]);
  });

  it("rejects a non-finite tail line limit", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);
    await writer.write("one", "stdout");

    await expect(writer.tail("stdout", Number.NaN)).rejects.toThrow(
      "lines must be a finite non-negative integer"
    );
  });

  it("full lifecycle keeps tail() scoped to the current run", async () => {
    const fs = createMemFs();
    const writer = createLogWriter("/logs", 3, fs);

    await writer.write("old-1", "stdout");
    await writer.write("old-2", "stdout");
    await writer.rotate();
    await writer.write("new-1", "stdout");
    await writer.write("new-2", "stdout");

    await expect(writer.tail("stdout")).resolves.toEqual(["new-1", "new-2"]);
    await expect(fs.readFile(path.join("/logs", "stdout.1.log"), "utf8")).resolves.toBe(
      "old-1\nold-2\n"
    );
  });
});
