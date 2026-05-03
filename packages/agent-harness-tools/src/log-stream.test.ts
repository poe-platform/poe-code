import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { streamLogFile, waitForExit, wrapForLogTee } from "./log-stream.js";

describe("streamLogFile", () => {
  it("replays a log file from offset 0", async () => {
    const { fs } = createMemFs({
      "/tmp/poe-jobs/job-1.log": "first\nsecond\n"
    });

    const chunks = await takeChunks(streamLogFile({ fs }, "job-1", {}), 1);

    expect(chunks).toEqual([{ byteOffset: 0, data: "first\nsecond\n" }]);
  });

  it("replays a log file from an arbitrary byte offset", async () => {
    const { fs } = createMemFs({
      "/tmp/poe-jobs/job-1.log": "first\nsecond\n"
    });

    const chunks = await takeChunks(streamLogFile({ fs }, "job-1", { sinceByte: 6 }), 1);

    expect(chunks).toEqual([{ byteOffset: 6, data: "second\n" }]);
  });

  it("polls for appended content when watch is unavailable", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs({
      "/tmp/poe-jobs/job-1.log": "first\n"
    });
    const env = { fs: { promises: fs.promises } };

    try {
      const chunksPromise = takeChunks(streamLogFile(env, "job-1", { sinceByte: 6 }), 1);

      await fs.promises.appendFile("/tmp/poe-jobs/job-1.log", "second\n");
      await vi.advanceTimersByTimeAsync(250);

      await expect(chunksPromise).resolves.toEqual([{ byteOffset: 6, data: "second\n" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls until the log file exists when watch is unavailable", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs({});
    const env = { fs: { promises: fs.promises } };

    try {
      const chunksPromise = takeChunks(streamLogFile(env, "job-1", {}), 1);

      await fs.promises.mkdir("/tmp/poe-jobs", { recursive: true });
      await fs.promises.writeFile("/tmp/poe-jobs/job-1.log", "created\n");
      await vi.advanceTimersByTimeAsync(250);

      await expect(chunksPromise).resolves.toEqual([{ byteOffset: 0, data: "created\n" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("waitForExit", () => {
  it("resolves with the parsed exit code", async () => {
    vi.useFakeTimers();
    const { fs } = createMemFs({});

    try {
      const waitPromise = waitForExit({ fs }, "job-1");

      await fs.promises.mkdir("/tmp/poe-jobs", { recursive: true });
      await fs.promises.writeFile("/tmp/poe-jobs/job-1.exit", "42\n");
      await vi.advanceTimersByTimeAsync(250);

      await expect(waitPromise).resolves.toEqual({ exitCode: 42 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects when the exit file does not contain an integer", async () => {
    const { fs } = createMemFs({
      "/tmp/poe-jobs/job-1.exit": "not-a-number\n"
    });

    await expect(waitForExit({ fs }, "job-1")).rejects.toThrow(
      "Invalid exit code in /tmp/poe-jobs/job-1.exit"
    );
  });
});

describe("wrapForLogTee", () => {
  it("wraps argv in a shell-safe tee command and escapes jobId paths", () => {
    const argv = wrapForLogTee(["printf", "hello ' world"], "job'1; rm -rf /");

    expect(argv[0]).toBe("sh");
    expect(argv[1]).toBe("-c");
    expect(argv[2]).toContain("mkdir -p '/tmp/poe-jobs'");
    expect(argv[2]).toContain("'printf' 'hello '\\'' world'");
    expect(argv[2]).toContain("'/tmp/poe-jobs/job'\\''1; rm -rf /.log'");
    expect(argv[2]).toContain("'/tmp/poe-jobs/job'\\''1; rm -rf /.exit'");
    expect(argv[2]).not.toContain("/tmp/poe-jobs/job'1; rm -rf /.log");
  });

  it("rejects an empty argv because there is no inner command to tee", () => {
    expect(() => wrapForLogTee([], "job-1")).toThrow("wrapForLogTee requires argv");
  });
});

function createMemFs(files: Record<string, string>) {
  const vol = Volume.fromJSON(files, "/");
  return { fs: createFsFromVolume(vol), vol };
}

async function takeChunks<T>(iterable: AsyncIterable<T>, count: number): Promise<T[]> {
  const chunks: T[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
    if (chunks.length === count) {
      break;
    }
  }

  return chunks;
}
