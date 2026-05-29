import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { createLogWriter } from "./log-writer.js";
import { createLogWriter as createLogWriterFromIndex } from "../index.js";
import type { LauncherFileSystem } from "../types.js";

function createMemFs(): LauncherFileSystem {
  const volume = new Volume();
  return createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
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
    await (fs as LauncherFileSystem & { symlink(target: string, path: string): Promise<void> }).symlink(
      "/outside",
      "/project/logs/linked"
    );
    const writer = createLogWriter("/project/logs/linked", 1, fs);

    await expect(writer.write("external write", "stdout")).rejects.toThrow("symbolic link");
    await expect(fs.readFile("/outside/stdout.log", "utf8")).rejects.toThrow();
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
