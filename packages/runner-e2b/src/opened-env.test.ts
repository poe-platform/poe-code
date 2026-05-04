import { describe, expect, it, vi } from "vitest";
import { createOpenedE2bEnv } from "./opened-env.js";

describe("createOpenedE2bEnv", () => {
  it("executes commands with E2B command run and returns a RunHandle", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const handle = env.exec({
      command: "printf",
      args: ["ok"],
      cwd: "/repo",
      env: { A: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.run).toHaveBeenCalledWith("'printf' 'ok'", {
      background: true,
      cwd: "/repo",
      envs: { A: "1" },
      stdin: true,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("creates a job handle for the last running command and preserves sandbox timeout on wait", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    sandbox.commands.list.mockResolvedValue([{ pid: 321, cmd: "node", args: [] }]);
    sandbox.files.read.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith(".exit")) {
        return "7\n";
      }
      return new Uint8Array();
    });
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), preserve_after_exit_hours: 2 },
      spec: createSpec()
    });

    const handle = env.exec({ command: "node", args: ["agent.js"] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    env.setDetachedJobContext({ id: "job-1", tool: "node", argv: ["node", "agent.js"] });
    const job = await env.detach();

    expect(job.id).toBe("job-1");
    expect(sandbox.setTimeout).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
    expect(sandbox.setTimeout).toHaveBeenCalledTimes(1);
    await expect(job.status()).resolves.toBe("exited");
    await expect(job.wait()).resolves.toEqual({ exitCode: 7 });
    expect(sandbox.setTimeout).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
    expect(sandbox.setTimeout).toHaveBeenCalledTimes(2);
    handle.kill();
    expect(commandHandle.kill).toHaveBeenCalled();
  });

  it("opens shell through E2B PTY", async () => {
    const ptyHandle = {
      pid: 12,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockResolvedValue(ptyHandle);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const handle = env.shell();

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.pty.create).toHaveBeenCalledWith({
      cols: expect.any(Number),
      rows: expect.any(Number),
      cwd: "/repo",
      envs: {},
      onData: expect.any(Function)
    });
  });

  it("exposes remote job log files for wrapped sync execution", async () => {
    const sandbox = createSandboxMock();
    sandbox.files.read.mockResolvedValue(new Uint8Array(Buffer.from("log\n")));
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const contents = await env.fs.promises.readFile("/tmp/poe-jobs/job-1.log");

    expect(contents.toString("utf8")).toBe("log\n");
    expect(sandbox.files.read).toHaveBeenCalledWith("/tmp/poe-jobs/job-1.log", {
      format: "bytes"
    });
  });
});

function createRuntime() {
  return {
    type: "e2b" as const,
    build_args: {},
    mounts: [],
    preserve_after_exit_hours: 24
  };
}

function createSpec() {
  return {
    cwd: "/repo",
    runtime: createRuntime(),
    env: {},
    uploadIgnoreFiles: [],
    jobLabel: { tool: "node", argv: ["node", "agent.js"] }
  };
}

function createSandboxMock() {
  return {
    sandboxId: "sb_test",
    commands: {
      list: vi.fn(),
      run: vi.fn(),
      connect: vi.fn(),
      sendStdin: vi.fn(),
      closeStdin: vi.fn(),
      kill: vi.fn()
    },
    files: {
      read: vi.fn(),
      write: vi.fn(),
      watchDir: vi.fn().mockResolvedValue({ stop: vi.fn() })
    },
    pty: {
      create: vi.fn(),
      sendInput: vi.fn(),
      kill: vi.fn()
    },
    setTimeout: vi.fn(),
    kill: vi.fn()
  };
}
