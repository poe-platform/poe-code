import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenedE2bEnv } from "./opened-env.js";

const fsMocks = vi.hoisted(() => ({
  mkdtempSync: vi.fn(),
  rmSync: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("node:fs", async (importActual) => ({
  ...(await importActual<typeof import("node:fs")>()),
  mkdtempSync: fsMocks.mkdtempSync,
  rmSync: fsMocks.rmSync
}));

vi.mock("node:fs/promises", async (importActual) => ({
  ...(await importActual<typeof import("node:fs/promises")>()),
  readFile: fsMocks.readFile,
  writeFile: fsMocks.writeFile
}));

describe("createOpenedE2bEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.mkdtempSync.mockImplementation((prefix: string) => `${prefix}test`);
    fsMocks.rmSync.mockImplementation(() => undefined);
    fsMocks.readFile.mockResolvedValue(Buffer.from("tar"));
    fsMocks.writeFile.mockResolvedValue(undefined);
  });

  it("executes commands in the sandbox workspace when cwd is the host workspace", async () => {
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
      envs: { A: "1" },
      stdin: true,
      onStdout: expect.any(Function),
      onStderr: expect.any(Function)
    });
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
    const hostRunner = createHostRunnerMock();
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue({ exitCode: 0 });
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: { ...createSpec(), hostRunner, uploadIgnoreFiles: ["node_modules"] }
    });

    await expect(env.uploadWorkspace()).resolves.toEqual({ files: 0, bytes: 0, skipped: [] });

    expect(hostRunner.exec).toHaveBeenCalledWith({
      command: "tar",
      args: [
        "--exclude",
        "node_modules",
        "-cf",
        expect.stringContaining("poe-e2b-upload-test/workspace.tar"),
        "-C",
        "/repo",
        "."
      ],
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(sandbox.files.write).toHaveBeenCalledWith(
      "/tmp/poe-workspace-upload.tar",
      expect.any(ArrayBuffer)
    );
    expect(sandbox.commands.run).toHaveBeenCalledWith(
      "mkdir -p '/sandbox/workspace' && tar -xf /tmp/poe-workspace-upload.tar -C '/sandbox/workspace'",
      {
        onStdout: expect.any(Function),
        onStderr: expect.any(Function)
      }
    );
  });

  it("decorates remote command exit errors with the command and stderr tail", async () => {
    const hostRunner = createHostRunnerMock();
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockImplementation(
      async (_command: string, opts?: { onStderr?: (data: string) => void }) => {
        for (let index = 1; index <= 35; index += 1) {
          opts?.onStderr?.(`stderr line ${index}\n`);
        }
        throw Object.assign(new Error("exit status 1"), {
          name: "CommandExitError",
          exitCode: 1
        });
      }
    );
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: { ...createSpec(), hostRunner }
    });

    let thrown: unknown;
    try {
      await env.uploadWorkspace();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(
      "E2B command failed: mkdir -p '/sandbox/workspace' && tar -xf /tmp/poe-workspace-upload.tar -C '/sandbox/workspace'"
    );
    expect(message).toContain("Last stderr output:");
    expect(message).toContain("stderr line 6");
    expect(message).toContain("stderr line 35");
    expect(message).not.toContain("stderr line 5");
  });

  it("uses stderr carried by remote command exit errors when callbacks do not receive output", async () => {
    const hostRunner = createHostRunnerMock();
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockRejectedValue(
      Object.assign(new Error("exit status 1"), {
        name: "CommandExitError",
        exitCode: 1,
        stderr: Array.from({ length: 35 }, (_value, index) => `error stderr ${index + 1}`).join(
          "\n"
        )
      })
    );
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: { ...createSpec(), hostRunner }
    });

    let thrown: unknown;
    try {
      await env.uploadWorkspace();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("E2B command failed: mkdir -p '/sandbox/workspace'");
    expect(message).toContain("error stderr 6");
    expect(message).toContain("error stderr 35");
    expect(message).not.toContain("error stderr 5");
  });

  it("downloads the sandbox workspace back into the host workspace", async () => {
    const hostRunner = createHostRunnerMock();
    const sandbox = createSandboxMock();
    sandbox.commands.run.mockResolvedValue({ exitCode: 0 });
    sandbox.files.read.mockResolvedValue(new Uint8Array(Buffer.from("tar")));
    const env = createOpenedE2bEnv({
      sandbox,
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: { ...createSpec(), hostRunner }
    });

    await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toEqual({
      files: 0,
      bytes: 3,
      conflicts: []
    });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      "tar -cf /tmp/poe-workspace-download.tar -C '/sandbox/workspace' .",
      {
        onStdout: expect.any(Function),
        onStderr: expect.any(Function)
      }
    );
    expect(hostRunner.exec).toHaveBeenCalledWith({
      command: "tar",
      args: ["-xf", expect.stringContaining("poe-e2b-download-test/workspace.tar"), "-C", "/repo"],
      stdout: "pipe",
      stderr: "pipe"
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
      runtime: { ...createRuntime(), workspace_dir: "/sandbox/workspace" },
      spec: createSpec()
    });

    const handle = env.shell();

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(sandbox.pty.create).toHaveBeenCalledWith({
      cols: expect.any(Number),
      rows: expect.any(Number),
      cwd: "/sandbox/workspace",
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
