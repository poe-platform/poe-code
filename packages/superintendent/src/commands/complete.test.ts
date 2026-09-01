import { Volume, createFsFromVolume } from "memfs";
import { defineGroup, type HandlerFs } from "toolcraft";
import { createCommandTestHarness, fakeService, type RunResult } from "toolcraft/testing";
import { describe, expect, it } from "vitest";
import { parseSuperintendentDoc } from "../document/parse.js";
import { completeCommand } from "./complete.js";

const targetPath = "docs/plans/feature.md";
const root = defineGroup({ name: "test", children: [completeCommand] });

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

type CompleteResult = {
  path: string;
  state: "completed";
  reason?: string;
  dryRun?: true;
};

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

function createVolumeFs(volume: Volume, overrides: Partial<HandlerFs> = {}): HandlerFs {
  const rawFs = createFsFromVolume(volume).promises;
  const baseFs: HandlerFs = {
    async readFile(filePath, encoding = "utf8") {
      return String(await rawFs.readFile(filePath, encoding));
    },
    async lstat(filePath) {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    async writeFile(filePath, content, options) {
      await rawFs.writeFile(filePath, content, options);
    },
    async rename(fromPath, toPath) {
      await rawFs.rename(fromPath, toPath);
    },
    async unlink(filePath) {
      await rawFs.unlink(filePath);
    },
    async exists(filePath) {
      try {
        await rawFs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }
  };
  return { ...baseFs, ...overrides };
}

async function runComplete(
  options: {
    content?: string;
    params?: Record<string, unknown>;
    fs?: HandlerFs;
  } = {}
): Promise<{
  harness: ReturnType<typeof createCommandTestHarness>;
  result: RunResult<CompleteResult>;
  updatedContent: string;
}> {
  const harness = createCommandTestHarness(root, {
    fs: options.fs ?? { [targetPath]: options.content ?? document }
  });
  const result = await harness.run<CompleteResult>(["complete"], {
    path: targetPath,
    ...options.params
  });

  return {
    harness,
    result,
    updatedContent: harness.fs.snapshot()[targetPath] ?? ""
  };
}

describe("superintendent complete command", () => {
  it("sets state to completed", async () => {
    const { result, updatedContent } = await runComplete();
    const updated = parseSuperintendentDoc(targetPath, updatedContent);

    expect(result.ok).toBe(true);
    expect(result.fsChanges.filter((change) => change.op === "writeFile")).toHaveLength(2);
    expect(updated.frontmatter.status).toEqual({
      state: "completed",
      round: 2,
      review_turn: 3
    });
  });

  it("preserves the existing task board without rewriting tasks", async () => {
    const { updatedContent } = await runComplete();
    const updated = parseSuperintendentDoc(targetPath, updatedContent);
    const original = parseSuperintendentDoc(targetPath, document);

    expect(updated.body).toBe(original.body);
  });

  it("accepts an optional reason", async () => {
    const { result, updatedContent } = await runComplete({
      params: { reason: "operator override" }
    });

    expect(updatedContent).toContain("reason: operator override");
    expect(result.value).toEqual({
      path: targetPath,
      state: "completed",
      reason: "operator override"
    });
  });

  it("removes an existing reason when no reason is provided", async () => {
    const { updatedContent } = await runComplete({ content: documentWithReason });

    expect(updatedContent).not.toContain("reason:");
  });

  it("previews completion without writing during dry run", async () => {
    const { result } = await runComplete({
      params: { reason: "operator override", dryRun: true }
    });

    expect(result.fsChanges).toEqual([]);
    expect(result.value).toEqual({
      path: targetPath,
      state: "completed",
      reason: "operator override",
      dryRun: true
    });
  });

  it("rejects invalid params before invoking injected services", async () => {
    const service = fakeService({ execute: () => "unused" });
    const harness = createCommandTestHarness(root, {
      fs: { [targetPath]: document },
      services: { service }
    });

    const result = await harness.run(["complete"], { path: 42 });

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe("params");
    expect(result.timeline).toEqual([]);
    expect(service.calls).toEqual([]);
  });

  it("rejects a symlinked document path before writing", async () => {
    const fs = createVolumeFs(Volume.fromJSON({ [targetPath]: document }, "/"), {
      lstat: async () => ({ isSymbolicLink: () => true })
    });
    const { result } = await runComplete({ fs });

    expect(result.failedAt).toBe("handler");
    expect(result.error).toHaveProperty("message", expect.stringMatching(/symbolic link/i));
    expect(result.fsChanges).toEqual([]);
  });

  it("reports a domain not-found error for missing documents", async () => {
    const harness = createCommandTestHarness(root);
    const result = await harness.run(["complete"], {
      path: "docs/plans/missing.md",
      dryRun: true
    });

    expect(result.failedAt).toBe("handler");
    expect(result.error).toHaveProperty(
      "message",
      "Superintendent document not found: docs/plans/missing.md"
    );
    expect(result.fsChanges).toEqual([]);
  });

  it("does not follow a preexisting legacy temp path symlink", async () => {
    const absoluteTargetPath = "/repo/docs/plans/feature.md";
    const outsidePath = "/outside/target.md";
    const volume = Volume.fromJSON(
      {
        [absoluteTargetPath]: document,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    volume.symlinkSync(outsidePath, `${absoluteTargetPath}.tmp`);
    const fs = createVolumeFs(volume);
    const harness = createCommandTestHarness(root, { fs });

    const result = await harness.run(["complete"], { path: absoluteTargetPath });

    expect(result.ok).toBe(true);
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
    await expect(fs.lstat(absoluteTargetPath)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function)
    });
    expect((await fs.lstat(absoluteTargetPath)).isSymbolicLink()).toBe(false);
    await expect(fs.readFile(absoluteTargetPath, "utf8")).resolves.toContain("state: completed");
  });

  it("does not remove a colliding completion temp symlink it did not create", async () => {
    const absoluteTargetPath = "/repo/docs/plans/feature.md";
    const outsidePath = "/outside/target.md";
    const volume = Volume.fromJSON(
      {
        [absoluteTargetPath]: document,
        [outsidePath]: "outside stays unchanged\n"
      },
      "/"
    );
    const rawFs = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fs = createVolumeFs(volume, {
      async writeFile(filePath, content, options) {
        if (
          temporaryPath === undefined &&
          filePath.startsWith(`${absoluteTargetPath}.`) &&
          filePath.endsWith(".tmp")
        ) {
          temporaryPath = filePath;
          volume.symlinkSync(outsidePath, filePath);
        }
        await rawFs.writeFile(filePath, content, options);
      }
    });
    const harness = createCommandTestHarness(root, { fs });

    const result = await harness.run(["complete"], { path: absoluteTargetPath });

    expect(result.failedAt).toBe("handler");
    expect(result.error).toHaveProperty("code", "EEXIST");
    expect(temporaryPath).toBeDefined();
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside stays unchanged\n");
    if (temporaryPath === undefined) {
      throw new Error("Expected a completion temporary path.");
    }
    expect((await fs.lstat(temporaryPath)).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(absoluteTargetPath, "utf8")).resolves.toBe(document);
  });

  it("preserves the document when completion persistence fails", async () => {
    const absoluteTargetPath = "/repo/docs/plans/feature.md";
    const volume = Volume.fromJSON({ [absoluteTargetPath]: document }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fs = createVolumeFs(volume, {
      async writeFile(filePath, content, options) {
        if (!filePath.endsWith(".tmp")) {
          await rawFs.writeFile(filePath, content, options);
          return;
        }
        temporaryPath = filePath;
        await rawFs.writeFile(filePath, content.slice(0, 12), options);
        throw new Error("disk full");
      }
    });
    const harness = createCommandTestHarness(root, { fs });

    const result = await withObjectPrototypeCode("EEXIST", () =>
      harness.run(["complete"], { path: absoluteTargetPath })
    );

    expect(result.failedAt).toBe("handler");
    expect(result.error).toHaveProperty("message", "disk full");
    await expect(fs.readFile(absoluteTargetPath, "utf8")).resolves.toBe(document);
    expect(temporaryPath?.startsWith(`${absoluteTargetPath}.`)).toBe(true);
    expect(temporaryPath?.endsWith(".tmp")).toBe(true);
    await expect(fs.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
