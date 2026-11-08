import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { buildDockerRunArgs } from "./args.js";
import { detectContext } from "./context.js";
import { detectEngine } from "./engine.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn()
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn()
}));

vi.mock("./engine.js", () => ({
  detectEngine: vi.fn()
}));

vi.mock("./context.js", async () => {
  const actual = await vi.importActual<typeof import("./context.js")>("./context.js");

  return {
    ...actual,
    detectContext: vi.fn()
  };
});

vi.mock("./args.js", async () => {
  const actual = await vi.importActual<typeof import("./args.js")>("./args.js");

  return {
    ...actual,
    buildDockerRunArgs: vi.fn(actual.buildDockerRunArgs)
  };
});

describe("createDockerRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(randomBytes).mockReturnValue(Buffer.from("abcdef", "hex"));
    vi.mocked(detectEngine).mockReturnValue("docker");
    vi.mocked(detectContext).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls docker run in foreground and exposes streams in piped mode", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({
      command: "node",
      args: ["--version"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(runner.name).toBe("docker");
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--name",
        "poe-run-node-abcdef",
        "node:22",
        "node",
        "--version"
      ],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    expect(handle.pid).toBeNull();
    expect(handle.stdin).toBe(child.stdin);
    expect(handle.stdout).toBe(child.stdout);
    expect(handle.stderr).toBe(child.stderr);

    child.emit("close", 0);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("calls docker run -it and exposes null streams in interactive mode", async () => {
    const child = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({
      command: "bash",
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      tty: true
    });

    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "-t",
        "--name",
        "poe-run-bash-abcdef",
        "node:22",
        "bash"
      ],
      {
        stdio: "inherit"
      }
    );
    expect(handle.stdin).toBeNull();
    expect(handle.stdout).toBeNull();
    expect(handle.stderr).toBeNull();

    child.emit("close", 0);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("kill with SIGTERM spawns docker stop", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const stopChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(stopChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({ command: "node" });
    handle.kill("SIGTERM");

    expect(vi.mocked(spawn)).toHaveBeenNthCalledWith(2, "docker", ["stop", "poe-run-node-abcdef"], {
      stdio: "ignore"
    });
    expect(stopChild.unref).toHaveBeenCalledTimes(1);
  });

  it("kill with SIGKILL spawns docker kill", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const killChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(killChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({ command: "node" });
    handle.kill("SIGKILL");

    expect(vi.mocked(spawn)).toHaveBeenNthCalledWith(2, "docker", ["kill", "poe-run-node-abcdef"], {
      stdio: "ignore"
    });
    expect(killChild.unref).toHaveBeenCalledTimes(1);
  });

  it("parses exit code from the docker process close event", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({ command: "node" });

    child.emit("close", 42);
    await expect(handle.result).resolves.toEqual({ exitCode: 42 });
  });

  it("resolves with exit code 1 when the docker process fails to spawn", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({ command: "node" });

    child.emit("error", new Error("spawn docker ENOENT"));
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("generates a container name from the command and random suffix", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    runner.exec({ command: "echo" });

    expect(buildDockerRunArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: "poe-run-echo-abcdef"
      })
    );
  });

  it("uses engine auto-detection when options.engine is omitted", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    vi.mocked(detectEngine).mockReturnValue("podman");
    const { createDockerRunner } = await import("./docker-runner.js");

    createDockerRunner({ image: "node:22" }).exec({ command: "node" });

    expect(detectEngine).toHaveBeenCalledTimes(1);
    expect(buildDockerRunArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "podman"
      })
    );
  });

  it("uses context auto-detection when options.context is omitted", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    vi.mocked(detectContext).mockReturnValue("colima");
    const { createDockerRunner } = await import("./docker-runner.js");

    createDockerRunner({ image: "node:22" }).exec({ command: "node" });

    expect(detectContext).toHaveBeenCalledTimes(1);
    expect(buildDockerRunArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "colima"
      })
    );
  });

  it("passes mounts from options to buildDockerRunArgs", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const mounts = [{ source: "/repo", target: "/workspace", readonly: true }] as const;

    createDockerRunner({ image: "node:22", mounts: [...mounts] }).exec({ command: "node" });

    expect(buildDockerRunArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        mounts
      })
    );
  });

  it("passes ports from options to buildDockerRunArgs", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");
    const ports = [{ host: 3000, container: 3000, protocol: "tcp" }] as const;

    createDockerRunner({ image: "node:22", ports: [...ports] }).exec({ command: "node" });

    expect(buildDockerRunArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        ports
      })
    );
  });

  it("passes env from RunSpec to buildDockerRunArgs", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    vi.mocked(spawn).mockReturnValue(child);
    const { createDockerRunner } = await import("./docker-runner.js");

    const handle = createDockerRunner({ image: "node:22" }).exec({
      command: "node",
      env: { FOO: "bar" }
    });
    const args = vi.mocked(spawn).mock.calls[0]?.[1] ?? [];
    const envFileIndex = args.indexOf("--env-file");
    const envFilePath = args[envFileIndex + 1];

    expect(buildDockerRunArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { FOO: "bar" },
        envFilePath: expect.stringMatching(/poe-docker-env-.+\/env$/)
      })
    );
    expect(envFileIndex).toBeGreaterThanOrEqual(0);
    expect(args.join("\0")).not.toContain("bar");
    expect(readFileSync(envFilePath ?? "", "utf8")).toBe("FOO=bar\n");

    child.emit("close", 0);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(existsSync(envFilePath ?? "")).toBe(false);
  });

  it("aborting the run triggers docker stop", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const stopChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(stopChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });
    const controller = new AbortController();

    runner.exec({ command: "node", signal: controller.signal });
    controller.abort();

    expect(vi.mocked(spawn)).toHaveBeenNthCalledWith(2, "docker", ["stop", "poe-run-node-abcdef"], {
      stdio: "ignore"
    });
    expect(stopChild.unref).toHaveBeenCalledTimes(1);
  });

  it("waits for the docker run child to close before resolving an aborted run", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const stopChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(stopChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const controller = new AbortController();
    const handle = createDockerRunner({ image: "node:22" }).exec({
      command: "node",
      signal: controller.signal
    });
    let settled = false;
    void handle.result.then(() => {
      settled = true;
    });

    controller.abort();
    await Promise.resolve();

    expect(settled).toBe(false);

    child.emit("close", 0);

    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
    expect(settled).toBe(true);
  });

  it("terminates the host docker process if abort does not close the child", async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const stopChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(stopChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const controller = new AbortController();
    const handle = createDockerRunner({ image: "node:22" }).exec({
      command: "node",
      signal: controller.signal
    });

    controller.abort();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(child.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");

    child.emit("close", null);
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("does not spawn a container command when already aborted", async () => {
    const { createDockerRunner } = await import("./docker-runner.js");
    const controller = new AbortController();
    controller.abort();

    const handle = createDockerRunner({ image: "node:22" }).exec({
      command: "node",
      signal: controller.signal
    });

    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("does not report success after an aborted command later exits zero", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const stopChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(stopChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const controller = new AbortController();
    const handle = createDockerRunner({ image: "node:22" }).exec({
      command: "node",
      signal: controller.signal
    });

    controller.abort();
    child.emit("close", 0);

    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("contains stop process spawn errors raised while aborting", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const stopChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(stopChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const controller = new AbortController();
    const handle = createDockerRunner({ image: "node:22" }).exec({
      command: "node",
      signal: controller.signal
    });

    controller.abort();
    expect(() => stopChild.emit("error", new Error("spawn docker ENOENT"))).not.toThrow();
    child.emit("close", 0);

    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("kill with other signals spawns docker kill with a signal override", async () => {
    const child = createMockChildProcess({ stdout: true, stderr: true, stdin: true });
    const killChild = createMockChildProcess({ stdout: false, stderr: false, stdin: false });
    vi.mocked(spawn).mockReturnValueOnce(child).mockReturnValueOnce(killChild);
    const { createDockerRunner } = await import("./docker-runner.js");
    const runner = createDockerRunner({ image: "node:22" });

    const handle = runner.exec({ command: "node" });
    handle.kill("SIGINT");

    expect(vi.mocked(spawn)).toHaveBeenNthCalledWith(2, "docker", [
      "kill",
      "--signal=SIGINT",
      "poe-run-node-abcdef"
    ], {
      stdio: "ignore"
    });
    expect(killChild.unref).toHaveBeenCalledTimes(1);
  });
});

function createMockChildProcess(options: {
  stdout: boolean;
  stderr: boolean;
  stdin: boolean;
}): ChildProcess {
  const child = new EventEmitter() as ChildProcess;

  Object.assign(child, {
    pid: 123,
    stdout: options.stdout ? new PassThrough() : null,
    stderr: options.stderr ? new PassThrough() : null,
    stdin: options.stdin ? new PassThrough() : null,
    kill: vi.fn(),
    unref: vi.fn()
  });

  return child;
}
