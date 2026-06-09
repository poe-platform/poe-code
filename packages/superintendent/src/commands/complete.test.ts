import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseSuperintendentDoc } from "../document/parse.js";

const document = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
status:
  state: review
  round: 2
  review_turn: 3
---
# Plan

## Task Board

- [ ] Keep this task open
- [x] Already done
`;

const documentWithReason = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: |
    Work on {{plan.path}}
superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}
owner:
  agent: claude-code
  prompt: |
    Review {{superintendent.summary}}
status:
  state: review
  round: 2
  review_turn: 3
  reason: stale override
---
# Plan

## Task Board

- [ ] Keep this task open
- [x] Already done
`;

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

async function runComplete(options: { content?: string; reason?: string } = {}): Promise<{
  result: unknown;
  updatedContent: string;
  writeFile: ReturnType<typeof vi.fn>;
}> {
  const { completeCommand } = await import("./complete.js");
  const writeFile = vi.fn(async () => undefined);
  const targetPath = "docs/plans/feature.md";

  const result = await completeCommand.handler({
    params: { path: targetPath, reason: options.reason },
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(async (inputPath: string) => {
        expect(inputPath).toBe(targetPath);
        return options.content ?? document;
      }),
      lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
      writeFile,
      rename: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
      exists: vi.fn(async () => true)
    },
    env: {
      get: vi.fn(() => undefined)
    },
    progress: vi.fn()
  });

  return {
    result,
    updatedContent: String(writeFile.mock.calls[0]?.[1] ?? ""),
    writeFile
  };
}

describe("superintendent complete command", () => {
  it("sets state to completed", async () => {
    const { updatedContent, writeFile } = await runComplete();
    const updated = parseSuperintendentDoc("docs/plans/feature.md", updatedContent);

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(updated.frontmatter.status).toEqual({
      state: "completed",
      round: 2,
      review_turn: 3
    });
  });

  it("preserves the existing task board without rewriting tasks", async () => {
    const { updatedContent } = await runComplete();
    const updated = parseSuperintendentDoc("docs/plans/feature.md", updatedContent);
    const original = parseSuperintendentDoc("docs/plans/feature.md", document);

    expect(updated.body).toBe(original.body);
  });

  it("accepts an optional reason", async () => {
    const { updatedContent, result } = await runComplete({
      reason: "operator override"
    });

    expect(updatedContent).toContain("reason: operator override");
    expect(result).toEqual({
      path: "docs/plans/feature.md",
      state: "completed",
      reason: "operator override"
    });
  });

  it("removes an existing reason when no reason is provided", async () => {
    const { updatedContent } = await runComplete({
      content: documentWithReason
    });

    expect(updatedContent).not.toContain("reason:");
  });

  it("previews completion without writing during dry run", async () => {
    const { completeCommand } = await import("./complete.js");
    const writeFile = vi.fn(async () => undefined);

    const result = await completeCommand.handler({
      params: { path: "docs/plans/feature.md", reason: "operator override", dryRun: true },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: vi.fn(async () => document),
        lstat: vi.fn(async () => ({ isSymbolicLink: () => false })),
        writeFile,
        rename: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
        exists: vi.fn(async () => true)
      },
      env: { get: vi.fn(() => undefined) },
      progress: vi.fn()
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      path: "docs/plans/feature.md",
      state: "completed",
      reason: "operator override",
      dryRun: true
    });
  });

  it("rejects a symlinked document path before writing", async () => {
    const { completeCommand } = await import("./complete.js");
    const writeFile = vi.fn(async () => undefined);

    await expect(completeCommand.handler({
      params: { path: "docs/plans/feature.md" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: vi.fn(async () => document),
        lstat: vi.fn(async () => ({ isSymbolicLink: () => true })),
        writeFile,
        rename: vi.fn(async () => undefined),
        unlink: vi.fn(async () => undefined),
        exists: vi.fn(async () => true)
      },
      env: { get: vi.fn(() => undefined) },
      progress: vi.fn()
    })).rejects.toThrow(/symbolic link/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does not follow a preexisting legacy temp path symlink", async () => {
    const { completeCommand } = await import("./complete.js");
    const targetPath = "/repo/docs/plans/feature.md";
    const outsidePath = "/outside/target.md";
    const volume = Volume.fromJSON(
      {
        [targetPath]: document,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    volume.symlinkSync(outsidePath, `${targetPath}.tmp`);
    const rawFs = createFsFromVolume(volume).promises;

    await completeCommand.handler({
      params: { path: targetPath },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: (filePath: string, encoding?: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
        lstat: async (filePath: string) => {
          const stat = await rawFs.lstat(filePath);
          return { isSymbolicLink: () => stat.isSymbolicLink() };
        },
        writeFile: async (
          filePath: string,
          content: string,
          options?: { encoding?: BufferEncoding; flag?: string }
        ) => {
          await rawFs.writeFile(filePath, content, options);
        },
        rename: (fromPath: string, toPath: string) => rawFs.rename(fromPath, toPath),
        unlink: (filePath: string) => rawFs.unlink(filePath),
        exists: vi.fn(async () => true)
      },
      env: { get: vi.fn(() => undefined) },
      progress: vi.fn()
    });

    await expect(rawFs.readFile(outsidePath, "utf8")).resolves.toBe(
      "outside stays unchanged\n"
    );
    const documentStat = await rawFs.lstat(targetPath);
    expect(documentStat.isSymbolicLink()).toBe(false);
    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toContain("state: completed");
  });

  it("does not remove a colliding completion temp symlink it did not create", async () => {
    const { completeCommand } = await import("./complete.js");
    const targetPath = "/repo/docs/plans/feature.md";
    const outsidePath = "/outside/target.md";
    const volume = Volume.fromJSON(
      {
        [targetPath]: document,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    const rawFs = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;

    await expect(completeCommand.handler({
      params: { path: targetPath },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: (filePath: string, encoding?: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
        lstat: async (filePath: string) => {
          const stat = await rawFs.lstat(filePath);
          return { isSymbolicLink: () => stat.isSymbolicLink() };
        },
        writeFile: async (
          filePath: string,
          content: string,
          options?: { encoding?: BufferEncoding; flag?: string }
        ) => {
          if (
            temporaryPath === undefined &&
            filePath.startsWith(`${targetPath}.`) &&
            filePath.endsWith(".tmp")
          ) {
            temporaryPath = filePath;
            volume.symlinkSync(outsidePath, filePath);
          }

          await rawFs.writeFile(filePath, content, options);
        },
        rename: (fromPath: string, toPath: string) => rawFs.rename(fromPath, toPath),
        unlink: (filePath: string) => rawFs.unlink(filePath),
        exists: vi.fn(async () => true)
      },
      env: { get: vi.fn(() => undefined) },
      progress: vi.fn()
    })).rejects.toMatchObject({ code: "EEXIST" });

    expect(temporaryPath).toBeDefined();
    await expect(rawFs.readFile(outsidePath, "utf8")).resolves.toBe(
      "outside stays unchanged\n"
    );
    const tempStat = await rawFs.lstat(temporaryPath as string);
    expect(tempStat.isSymbolicLink()).toBe(true);
    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toBe(document);
  });

  it("preserves the document when completion persistence fails", async () => {
    const { completeCommand } = await import("./complete.js");
    const targetPath = "/repo/docs/plans/feature.md";
    const volume = Volume.fromJSON({ [targetPath]: document }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(completeCommand.handler({
        params: { path: targetPath },
        secrets: {},
        fetch: globalThis.fetch,
        fs: {
          readFile: (filePath: string, encoding?: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
          lstat: async (filePath: string) => {
            const stat = await rawFs.lstat(filePath);
            return { isSymbolicLink: () => stat.isSymbolicLink() };
          },
          writeFile: async (
            filePath: string,
            content: string,
            options?: { encoding?: BufferEncoding; flag?: string }
          ) => {
            temporaryPath = filePath;
            await rawFs.writeFile(filePath, content.slice(0, 12), options);
            throw new Error("disk full");
          },
          rename: (fromPath: string, toPath: string) => rawFs.rename(fromPath, toPath),
          unlink: (filePath: string) => rawFs.unlink(filePath),
          exists: vi.fn(async () => true)
        },
        env: { get: vi.fn(() => undefined) },
        progress: vi.fn()
      })).rejects.toThrow("disk full");
    });
    await expect(rawFs.readFile(targetPath, "utf8")).resolves.toBe(document);
    expect(temporaryPath?.startsWith(`${targetPath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(rawFs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
