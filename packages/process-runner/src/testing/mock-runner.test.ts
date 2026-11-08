import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRunner, createMockRunnerByCommand } from "./mock-runner.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createMockRunner", () => {
  it("replays behaviors in order", async () => {
    const runner = createMockRunner([
      { pid: 11, exitCode: 0 },
      { pid: 22, exitCode: 1 }
    ]);

    const first = runner.exec({ command: "first" });
    const second = runner.exec({ command: "second" });

    expect(first.pid).toBe(11);
    expect(second.pid).toBe(22);
    await expect(first.result).resolves.toEqual({ exitCode: 0 });
    await expect(second.result).resolves.toEqual({ exitCode: 1 });
  });

  it("emits stdout lines from behavior.stdout array", async () => {
    vi.useFakeTimers();
    const runner = createMockRunner([
      {
        exitCode: 0,
        stdout: ["first\n", "second\n"],
        stdoutInterval: 5
      }
    ]);

    const handle = runner.exec({ command: "echo", stdout: "pipe" });
    const stdoutPromise = readStream(handle.stdout);

    await vi.advanceTimersByTimeAsync(15);

    await expect(stdoutPromise).resolves.toEqual(["first\n", "second\n"]);
  });

  it("emits stderr lines from behavior.stderr array", async () => {
    vi.useFakeTimers();
    const runner = createMockRunner([
      {
        exitCode: 0,
        stderr: ["warn\n", "error\n"],
        stdoutInterval: 5
      }
    ]);

    const handle = runner.exec({ command: "echo", stderr: "pipe" });
    const stderrPromise = readStream(handle.stderr);

    await vi.advanceTimersByTimeAsync(15);

    await expect(stderrPromise).resolves.toEqual(["warn\n", "error\n"]);
  });

  it("resolves result with programmed exitCode", async () => {
    const runner = createMockRunner([{ exitCode: 27 }]);

    const handle = runner.exec({ command: "exit" });

    await expect(handle.result).resolves.toEqual({ exitCode: 27 });
  });

  it("resolves result after exitAfterMs delay", async () => {
    vi.useFakeTimers();
    const runner = createMockRunner([{ exitCode: 0, exitAfterMs: 25 }]);

    const handle = runner.exec({ command: "sleep" });
    let settled = false;
    void handle.result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(24);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("does not resolve a default completion before configured output ends", async () => {
    vi.useFakeTimers();
    const runner = createMockRunner([
      { exitCode: 0, stdout: ["output\n"], stdoutInterval: 10 }
    ]);

    const handle = runner.exec({ command: "echo", stdout: "pipe" });
    let settled = false;
    void handle.result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(9);
    expect(settled).toBe(false);

    const stdoutPromise = readStream(handle.stdout);
    await vi.advanceTimersByTimeAsync(1);
    await expect(stdoutPromise).resolves.toEqual(["output\n"]);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("rejects non-finite exit delays", () => {
    const runner = createMockRunner([{ exitCode: 0, exitAfterMs: Number.POSITIVE_INFINITY }]);

    expect(() => runner.exec({ command: "never" })).toThrow(
      "Mock run exitAfterMs must be a finite non-negative number."
    );
  });

  it("throws when behaviors are exhausted", () => {
    const runner = createMockRunner([{ exitCode: 0 }]);

    runner.exec({ command: "once" });

    expect(() => runner.exec({ command: "twice" })).toThrow(
      "No mock run behaviors left"
    );
  });

  it("returns null streams for inherit mode", () => {
    const runner = createMockRunner([
      {
        exitCode: 0,
        stdout: ["ignored"],
        stderr: ["ignored"]
      }
    ]);

    const handle = runner.exec({
      command: "inherit",
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    });

    expect(handle.stdin).toBeNull();
    expect(handle.stdout).toBeNull();
    expect(handle.stderr).toBeNull();
  });

  it("does not create stdout or stderr streams when behavior omits them", () => {
    const runner = createMockRunner([{ exitCode: 0 }]);

    const handle = runner.exec({
      command: "silent",
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(handle.stdout).toBeNull();
    expect(handle.stderr).toBeNull();
  });

  it("kill causes result to resolve", async () => {
    vi.useFakeTimers();
    const runner = createMockRunner([{ exitCode: 0, exitAfterMs: 1000 }]);

    const handle = runner.exec({ command: "long" });
    let settled = false;
    void handle.result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    handle.kill();
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });
});

describe("createMockRunnerByCommand", () => {
  it("matches behaviors by command", async () => {
    const runner = createMockRunnerByCommand({
      foo: { pid: 91, exitCode: 0 },
      bar: { pid: 92, exitCode: 2 }
    });

    const foo = runner.exec({ command: "foo" });
    const bar = runner.exec({ command: "bar" });

    expect(foo.pid).toBe(91);
    expect(bar.pid).toBe(92);
    await expect(foo.result).resolves.toEqual({ exitCode: 0 });
    await expect(bar.result).resolves.toEqual({ exitCode: 2 });
  });

  it("throws when command is not found", () => {
    const runner = createMockRunnerByCommand({
      foo: { exitCode: 0 }
    });

    expect(() => runner.exec({ command: "missing" })).toThrow(
      'No mock run behavior found for command "missing"'
    );
  });

  it("does not resolve inherited command behavior entries", () => {
    const runner = createMockRunnerByCommand({});

    expect(() => runner.exec({ command: "constructor" })).toThrow(
      'No mock run behavior found for command "constructor"'
    );
  });
});

async function readStream(stream: NodeJS.ReadableStream | null): Promise<string[]> {
  if (stream === null) {
    return [];
  }

  const chunks: string[] = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    chunks.push(chunk);
  });
  await once(stream, "end");
  return chunks;
}
