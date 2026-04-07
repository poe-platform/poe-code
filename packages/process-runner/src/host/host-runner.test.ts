import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHostRunner } from "./host-runner.js";

describe("createHostRunner", () => {
  it("spawns in piped mode and exposes streams on the run handle", async () => {
    const runner = createHostRunner();

    const handle = runner.exec({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('hello'); setTimeout(() => { process.stderr.write('warn', () => process.exit(0)); }, 10);"
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(runner.name).toBe("host");
    expect(handle.pid).toBeTypeOf("number");
    expect(handle.stdin).not.toBeNull();
    expect(handle.stdout).not.toBeNull();
    expect(handle.stderr).not.toBeNull();
    const [stdout, stderr, result] = await Promise.all([
      readStream(handle.stdout),
      readStream(handle.stderr),
      handle.result
    ]);
    expect(stdout).toBe("hello");
    expect(stderr).toBe("warn");
    expect(result).toEqual({ exitCode: 0 });
  });

  it("spawns in inherit mode and exposes null streams on the run handle", async () => {
    const runner = createHostRunner();

    const handle = runner.exec({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    });

    expect(handle.stdin).toBeNull();
    expect(handle.stdout).toBeNull();
    expect(handle.stderr).toBeNull();
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("treats tty as a no-op", async () => {
    const runner = createHostRunner();

    const handle = runner.exec({
      command: process.execPath,
      args: ["-e", "process.stdout.write('tty-noop')"],
      tty: true,
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(handle.stdin).toBeNull();
    expect(handle.stdout).not.toBeNull();
    expect(handle.stderr).not.toBeNull();
    await expect(readStream(handle.stdout)).resolves.toBe("tty-noop");
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("kill sends a signal to the child process", async () => {
    const runner = createHostRunner();
    const handle = runner.exec({
      command: "sleep",
      args: ["60"]
    });

    handle.kill("SIGTERM");

    const result = await handle.result;
    expect(result.exitCode).not.toBe(0);
  });

  it("abort signal sends SIGTERM", async () => {
    const runner = createHostRunner();
    const controller = new AbortController();
    const handle = runner.exec({
      command: "sleep",
      args: ["60"],
      signal: controller.signal
    });

    controller.abort();

    const result = await handle.result;
    expect(result.exitCode).not.toBe(0);
  });

  it.runIf(process.platform !== "win32")(
    "uses process group kill for detached mode on unix",
    async () => {
      const originalKill = process.kill.bind(process);
      const processKillSpy = vi
        .spyOn(process, "kill")
        .mockImplementation((pid: number, signal?: NodeJS.Signals | number) => {
          return originalKill(pid, signal);
        });
      const runner = createHostRunner({ detached: true });
      const handle = runner.exec({ command: "sleep", args: ["60"] });

      handle.kill("SIGKILL");

      await expect(handle.result).resolves.toEqual({ exitCode: 1 });
      expect(processKillSpy).toHaveBeenCalledWith(-(handle.pid as number), "SIGKILL");
    }
  );

  it("unrefs detached child processes", async () => {
    const child = {
      pid: 123,
      stdin: null,
      stdout: null,
      stderr: null,
      kill: vi.fn(),
      once: vi.fn(),
      unref: vi.fn()
    };
    const spawnMock = vi.fn(() => child);

    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      spawn: spawnMock
    }));

    const { createHostRunner: createDetachedHostRunner } = await import("./host-runner.js");
    const runner = createDetachedHostRunner({ detached: true });
    runner.exec({ command: "sleep", args: ["60"] });

    expect(spawnMock).toHaveBeenCalledWith(
      "sleep",
      ["60"],
      expect.objectContaining({ detached: true })
    );
    expect(child.unref).toHaveBeenCalledTimes(1);

    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("uses default stdio modes when omitted", async () => {
    const runner = createHostRunner();
    const handle = runner.exec({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('default-out'); setTimeout(() => { process.stderr.write('default-err', () => process.exit(0)); }, 10);"
      ]
    });

    expect(handle.stdin).toBeNull();
    expect(handle.stdout).not.toBeNull();
    expect(handle.stderr).not.toBeNull();
    const [stdout, stderr, result] = await Promise.all([
      readStream(handle.stdout),
      readStream(handle.stderr),
      handle.result
    ]);
    expect(stdout).toBe("default-out");
    expect(stderr).toBe("default-err");
    expect(result).toEqual({ exitCode: 0 });
  });

  it("passes cwd to child_process.spawn", async () => {
    const runner = createHostRunner();
    const cwd = path.join(process.cwd(), "packages", "process-runner");
    const handle = runner.exec({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd
    });

    await expect(readStream(handle.stdout)).resolves.toBe(cwd);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("passes env to child_process.spawn without merging", async () => {
    const runner = createHostRunner();
    const handle = runner.exec({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({ foo: process.env.FOO ?? null, path: process.env.PATH ?? null }))"
      ],
      env: {
        FOO: "bar"
      }
    });

    await expect(readStream(handle.stdout)).resolves.toBe(
      JSON.stringify({
        foo: "bar",
        path: null
      })
    );
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("preserves non-zero exit codes", async () => {
    const runner = createHostRunner();

    const handle = runner.exec({
      command: "sh",
      args: ["-c", "exit 42"]
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 42 });
  });

  it("spawns a real process and captures stdout", async () => {
    const runner = createHostRunner();
    const handle = runner.exec({
      command: "echo",
      args: ["hello"],
      stdout: "pipe"
    });

    const output = await readStream(handle.stdout);

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(output).toContain("hello");
  });
});

async function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) {
    return "";
  }

  stream.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }
  return chunks.join("");
}
