import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenedE2bEnv } from "./opened-env.js";

const workspaceTransferMocks = vi.hoisted(() => ({
  uploadWorkspace: vi.fn(),
  downloadWorkspace: vi.fn()
}));

vi.mock("@poe-code/agent-harness-tools", async (importActual) => ({
  ...(await importActual<typeof import("@poe-code/agent-harness-tools")>()),
  uploadWorkspace: workspaceTransferMocks.uploadWorkspace,
  downloadWorkspace: workspaceTransferMocks.downloadWorkspace
}));

describe("createOpenedE2bEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceTransferMocks.uploadWorkspace.mockResolvedValue({ files: 0, bytes: 0, skipped: [] });
    workspaceTransferMocks.downloadWorkspace.mockResolvedValue({ files: 0, bytes: 0, conflicts: [] });
  });

  it("executes commands in the sandbox workspace when cwd is the host workspace", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    sandbox.commands.sendStdin.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
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
      cwd: "/sandbox/workspace",
      envs: { A: "1", HOME: "/home/user" },
      stdin: true,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("maps host workspace subdirectory cwd values into the sandbox workspace", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: createSpec()
    });

    const handle = env.exec({
      command: "pwd",
      cwd: "/repo/packages/api"
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.run).toHaveBeenCalledWith("'pwd'", {
      background: true,
      cwd: "/sandbox/workspace/packages/api",
      envs: undefined,
      stdin: false,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("does not launch a command when the signal is already aborted", async () => {
    const sandbox = createSandboxMock();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });
    const controller = new AbortController();
    controller.abort();

    const handle = env.exec({ command: "node", signal: controller.signal });

    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
    expect(sandbox.commands.run).not.toHaveBeenCalled();
  });

  it("kills an in-flight command when the signal aborts", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockReturnValue(new Promise(() => {})),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    sandbox.commands.sendStdin.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });
    const controller = new AbortController();

    env.exec({ command: "node", signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    expect(commandHandle.kill).toHaveBeenCalledOnce();
  });

  it("kills a command if kill is requested before the E2B command handle resolves", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockReturnValue(new Promise(() => {})),
      kill: vi.fn()
    };
    let resolveRun!: (handle: typeof commandHandle) => void;
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      })
    );
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const handle = env.exec({ command: "node" });
    handle.kill();
    expect(commandHandle.kill).not.toHaveBeenCalled();

    resolveRun(commandHandle);

    await vi.waitFor(() => {
      expect(commandHandle.kill).toHaveBeenCalledOnce();
    });
  });

  it("queues stdin writes until the E2B command handle is ready", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    let resolveRun!: (handle: typeof commandHandle) => void;
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      })
    );
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const handle = env.exec({
      command: "cat",
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    const stdinFinished = new Promise<void>((resolve, reject) => {
      handle.stdin!.end("hello", (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(sandbox.commands.sendStdin).not.toHaveBeenCalled();

    resolveRun(commandHandle);

    await stdinFinished;
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.sendStdin).toHaveBeenCalledWith(321, Buffer.from("hello"));
    expect(sandbox.commands.closeStdin).toHaveBeenCalledWith(321);
  });

  it("forwards inherited stdin to a running E2B command and cleans up listeners", async () => {
    let resolveWait!: (result: { exitCode: number }) => void;
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveWait = resolve;
        })
      ),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    sandbox.commands.sendStdin.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });
    const listenersBefore = process.stdin.listenerCount("data");

    const handle = env.exec({ command: "cat", stdin: "inherit", stdout: "pipe", stderr: "pipe" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(process.stdin.listenerCount("data")).toBe(listenersBefore + 1);
    process.stdin.emit("data", Buffer.from("hello"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      "'cat'",
      expect.objectContaining({ stdin: true })
    );
    await vi.waitFor(() => {
      expect(sandbox.commands.sendStdin).toHaveBeenCalledWith(321, Buffer.from("hello"));
    });
    resolveWait({ exitCode: 0 });
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(process.stdin.listenerCount("data")).toBe(listenersBefore);
  });

  it("rejects when the remote command API fails before running a command", async () => {
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockRejectedValue(new Error("sandbox transport offline"));
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    await expect(env.exec({ command: "node" }).result).rejects.toThrow("sandbox transport offline");
  });

  it("contains command termination failures from synchronous kill requests", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockReturnValue(new Promise(() => {})),
      kill: vi.fn().mockRejectedValue(new Error("command kill failed"))
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    sandbox.commands.sendStdin.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const handle = env.exec({ command: "node" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    handle.kill();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(commandHandle.kill).toHaveBeenCalledOnce();
  });

  it("leaves non-workspace command cwd values unchanged", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: createSpec()
    });

    const handle = env.exec({
      command: "pwd",
      cwd: "/tmp"
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.run).toHaveBeenCalledWith("'pwd'", {
      background: true,
      cwd: "/tmp",
      envs: undefined,
      stdin: false,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("uses the sandbox home instead of leaking the host HOME into commands", async () => {
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
      command: "poe-code",
      args: ["configure"],
      cwd: "/repo",
      env: { HOME: "/Users/local-dev", POE_API_KEY: "test-key" }
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.run).toHaveBeenCalledWith("'poe-code' 'configure'", {
      background: true,
      cwd: "/workspace",
      envs: { HOME: "/home/user", POE_API_KEY: "test-key" },
      stdin: false,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("uses /workspace as the default sandbox workspace", async () => {
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
      command: "pwd",
      cwd: "/repo/."
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.run).toHaveBeenCalledWith("'pwd'", {
      background: true,
      cwd: "/workspace",
      envs: undefined,
      stdin: false,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("normalizes configured sandbox workspace directories", async () => {
    const commandHandle = {
      pid: 321,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue(commandHandle);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace/../project/" },
      spec: createSpec()
    });

    const handle = env.exec({
      command: "pwd",
      cwd: "/repo"
    });

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.commands.run).toHaveBeenCalledWith("'pwd'", {
      background: true,
      cwd: "/sandbox/project",
      envs: undefined,
      stdin: false,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
  });

  it("uploads the host workspace into the sandbox workspace", async () => {
    const sandbox = createSandboxMock();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: { ...createSpec(), uploadIgnoreFiles: ["node_modules"] }
    });

    await expect(env.uploadWorkspace()).resolves.toEqual({ files: 0, bytes: 0, skipped: [] });

    expect(workspaceTransferMocks.uploadWorkspace).toHaveBeenCalledWith(
      {
        cwd: "/repo",
        uploadDir: "/tmp/poe-workspace-transfer",
        workspaceDir: "/sandbox/workspace",
        remoteFs: expect.objectContaining({
          mkdir: expect.any(Function),
          readdir: expect.any(Function),
          readFile: expect.any(Function),
          writeFile: expect.any(Function),
          stat: expect.any(Function),
          rename: expect.any(Function),
          rm: expect.any(Function)
        })
      },
      { runner: undefined, workspaceExclude: ["node_modules"] }
    );
  });

  it("skips workspace upload when runner sync is none", async () => {
    const hostRunner = createHostRunnerMock();
    const sandbox = createSandboxMock();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: {
        ...createSpec(),
        hostRunner,
        runner: {
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "refuse",
          sync: "none"
        }
      }
    });

    await expect(env.uploadWorkspace()).resolves.toEqual({ files: 0, bytes: 0, skipped: [] });

    expect(hostRunner.exec).not.toHaveBeenCalled();
    expect(sandbox.files.write).not.toHaveBeenCalled();
    expect(sandbox.commands.run).not.toHaveBeenCalled();
    expect(workspaceTransferMocks.uploadWorkspace).not.toHaveBeenCalled();
  });

  it("downloads the sandbox workspace back into the host workspace", async () => {
    const sandbox = createSandboxMock();
    workspaceTransferMocks.downloadWorkspace.mockResolvedValue({ files: 1, bytes: 3, conflicts: [] });
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: createSpec()
    });

    await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toEqual({
      files: 1,
      bytes: 3,
      conflicts: []
    });

    expect(workspaceTransferMocks.downloadWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo", workspaceDir: "/sandbox/workspace" }),
      { conflictPolicy: "overwrite" }
    );
  });

  it("skips workspace download when runner sync is upload-only", async () => {
    const hostRunner = createHostRunnerMock();
    const sandbox = createSandboxMock();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: {
        ...createSpec(),
        hostRunner,
        runner: {
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "refuse",
          sync: "upload"
        }
      }
    });

    await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toEqual({
      files: 0,
      bytes: 0,
      conflicts: []
    });

    expect(hostRunner.exec).not.toHaveBeenCalled();
    expect(sandbox.files.read).not.toHaveBeenCalled();
    expect(sandbox.commands.run).not.toHaveBeenCalled();
    expect(workspaceTransferMocks.downloadWorkspace).not.toHaveBeenCalled();
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
    sandbox.pty.sendInput.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: createSpec()
    });

    const handle = env.shell();

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.pty.create).toHaveBeenCalledWith({
      cols: expect.any(Number),
      rows: expect.any(Number),
      cwd: "/sandbox/workspace",
      envs: { HOME: "/home/user" },
      onData: expect.any(Function)
    });
  });

  it("launches an explicitly configured interactive command inside the PTY", async () => {
    const ptyHandle = {
      pid: 12,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockResolvedValue(ptyHandle);
    sandbox.pty.sendInput.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: {
        ...createSpec(),
        shellSpec: { command: "node", args: ["interactive-agent.js", "--chat"] }
      }
    });

    await expect(env.shell().result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.pty.sendInput).toHaveBeenCalledWith(
      12,
      Buffer.from("exec 'node' 'interactive-agent.js' '--chat'\r")
    );
  });

  it("does not open a PTY when the interactive shell signal is already aborted", async () => {
    const sandbox = createSandboxMock();
    const controller = new AbortController();
    controller.abort();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: {
        ...createSpec(),
        shellSpec: { command: "bash", signal: controller.signal }
      }
    });

    const handle = env.shell();

    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
    expect(sandbox.pty.create).not.toHaveBeenCalled();
  });

  it("kills an in-flight PTY when the interactive shell signal aborts", async () => {
    let resolveWait!: (result: { exitCode: number }) => void;
    const ptyHandle = {
      pid: 12,
      wait: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveWait = resolve;
        })
      ),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockResolvedValue(ptyHandle);
    sandbox.pty.sendInput.mockResolvedValue(undefined);
    sandbox.pty.kill.mockResolvedValue(undefined);
    const controller = new AbortController();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: {
        ...createSpec(),
        shellSpec: { command: "bash", signal: controller.signal }
      }
    });

    const handle = env.shell();
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    expect(sandbox.pty.kill).toHaveBeenCalledWith(12);
    resolveWait({ exitCode: 1 });
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("kills the PTY if the interactive shell signal aborts before PTY creation resolves", async () => {
    let resolveCreate!: (handle: { pid: number; wait: () => Promise<{ exitCode: number }> }) => void;
    let resolveWait!: (result: { exitCode: number }) => void;
    const ptyHandle = {
      pid: 12,
      wait: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveWait = resolve;
        })
      )
    };
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    sandbox.pty.sendInput.mockResolvedValue(undefined);
    sandbox.pty.kill.mockResolvedValue(undefined);
    const controller = new AbortController();
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: {
        ...createSpec(),
        shellSpec: { command: "bash", signal: controller.signal }
      }
    });

    const handle = env.shell();
    controller.abort();
    expect(sandbox.pty.kill).not.toHaveBeenCalled();

    resolveCreate(ptyHandle);
    await vi.waitFor(() => {
      expect(sandbox.pty.kill).toHaveBeenCalledWith(12);
    });
    resolveWait({ exitCode: 1 });
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("forwards inherited stdin to an E2B PTY and cleans up listeners", async () => {
    let resolveWait!: (result: { exitCode: number }) => void;
    const ptyHandle = {
      pid: 12,
      wait: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveWait = resolve;
        })
      ),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockResolvedValue(ptyHandle);
    sandbox.pty.sendInput.mockResolvedValue(undefined);
    const env = createOpenedE2bEnv({ sandbox, runtime: createRuntime(), spec: createSpec() });
    const listenersBefore = process.stdin.listenerCount("data");

    const handle = env.shell();
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.stdin.emit("data", Buffer.from("hello"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(sandbox.pty.sendInput).toHaveBeenCalledWith(12, Buffer.from("hello"));
    resolveWait({ exitCode: 0 });
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(process.stdin.listenerCount("data")).toBe(listenersBefore);
  });

  it("rejects when the remote PTY API cannot create a shell", async () => {
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockRejectedValue(new Error("pty service offline"));
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    await expect(env.shell().result).rejects.toThrow("pty service offline");
  });

  it("contains PTY termination failures from synchronous kill requests", async () => {
    const ptyHandle = {
      pid: 12,
      wait: vi.fn().mockReturnValue(new Promise(() => {})),
      kill: vi.fn()
    };
    const sandbox = createSandboxMock();
    sandbox.pty.create.mockResolvedValue(ptyHandle);
    sandbox.pty.kill.mockRejectedValue(new Error("pty kill failed"));
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: createRuntime(),
      spec: createSpec()
    });

    const handle = env.shell();
    await new Promise<void>((resolve) => setImmediate(resolve));
    handle.kill();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(sandbox.pty.kill).toHaveBeenCalledWith(12);
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

function createHostRunnerMock() {
  return {
    name: "host",
    exec: vi.fn().mockReturnValue({
      pid: null,
      stdin: null,
      stdout: null,
      stderr: null,
      result: Promise.resolve({ exitCode: 0 }),
      kill: vi.fn()
    })
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
      list: vi.fn(),
      makeDir: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      getInfo: vi.fn(),
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
