import { setImmediate } from "node:timers/promises";
import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { withDocumentStatusLock } from "./status-lock.js";

const docPath = "/repo/plan.md";
const lockPath = "/repo/.plan.md.status.lock";

function fixture() {
  const raw = createFsFromVolume(Volume.fromJSON({ [docPath]: "Original plan" }, "/")).promises;
  const file = {
    writeFile: async (filename: string, contents: string, options?: { flag?: string }) => {
      await raw.writeFile(filename, contents, options);
    },
    unlink: async (filename: string) => {
      await raw.unlink(filename);
    }
  };
  const directory = {
    writeFile: file.writeFile,
    mkdir: async (filename: string) => {
      await raw.mkdir(filename);
    },
    rmdir: async (filename: string) => {
      await raw.rmdir(filename);
    }
  };
  return { raw, file, directory };
}

for (const firstKind of ["file", "directory"] as const) {
  it(`serializes separate adapters when the first status lock is a ${firstKind}`, async () => {
    const current = fixture();
    const calls: string[] = [];
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withDocumentStatusLock(docPath, current[firstKind], async () => {
      calls.push("first");
      started();
      await held;
      return "first result";
    });
    await ready;
    const second = withDocumentStatusLock(
      docPath,
      current[firstKind === "file" ? "directory" : "file"],
      async () => {
        calls.push("second");
        return "second result";
      }
    );
    await setImmediate();
    expect(calls).toEqual(["first"]);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["first result", "second result"]);
    expect(calls).toEqual(["first", "second"]);
    expect(await current.raw.readdir("/repo")).toEqual(["plan.md"]);
  });
}

it("releases status ownership when the operation fails", async () => {
  const current = fixture();
  const failure = new Error("Write failed");
  await expect(
    withDocumentStatusLock(docPath, current.file, async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  await expect(
    withDocumentStatusLock(docPath, current.directory, async () => "retry")
  ).resolves.toBe("retry");
  expect(await current.raw.readdir("/repo")).toEqual(["plan.md"]);
});

it("reports both the operation and lock cleanup failures", async () => {
  const current = fixture();
  const failure = new Error("Write failed");
  const cleanup = new Error("Cleanup failed");
  const result = await withDocumentStatusLock(
    docPath,
    {
      ...current.file,
      unlink: async () => {
        throw cleanup;
      }
    },
    async () => {
      throw failure;
    }
  ).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect((result as AggregateError).errors).toEqual([failure, cleanup]);
  expect(await current.raw.readFile(docPath, "utf8")).toBe("Original plan");
});

it("bounds contention and names an abandoned lock without removing it", async () => {
  const current = fixture();
  await current.raw.writeFile(lockPath, "existing owner");
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  try {
    const operation = vi.fn(async () => undefined);
    const result = withDocumentStatusLock(docPath, current.directory, operation).catch(
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toHaveProperty("message", expect.stringContaining(lockPath));
    expect(await result).toHaveProperty(
      "message",
      expect.stringContaining("If no loop or completion process is running")
    );
    expect(operation).not.toHaveBeenCalled();
    expect(await current.raw.readFile(lockPath, "utf8")).toBe("existing owner");
  } finally {
    vi.useRealTimers();
  }
});
