import { describe, expect, it, vi } from "vitest";
import { hostExecutionEnvFactory } from "./host-execution-env.js";
import type { OpenSpec, RunHandle } from "../types.js";

describe("hostExecutionEnvFactory", () => {
  it("round-trips exec through the host runner", async () => {
    const env = await hostExecutionEnvFactory.open(createOpenSpec());

    const handle = env.exec({
      command: process.execPath,
      args: ["-e", "process.stdout.write('host-env')"],
      stdout: "pipe",
      stderr: "pipe"
    });

    await expect(readStream(handle.stdout)).resolves.toBe("host-env");
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(env.id).toBe("host");
    expect(env.job).toBeNull();
  });

  it("treats workspace upload and download as no-ops", async () => {
    const env = await hostExecutionEnvFactory.open(createOpenSpec());

    await expect(env.uploadWorkspace()).resolves.toEqual({
      files: 0,
      bytes: 0,
      skipped: []
    });
    await expect(
      env.downloadWorkspace({
        conflictPolicy: "refuse"
      })
    ).resolves.toEqual({
      files: 0,
      bytes: 0,
      conflicts: []
    });
    await expect(env.close()).resolves.toBeUndefined();
  });

  it("rejects attach because host runtime cannot reattach", async () => {
    await expect(hostExecutionEnvFactory.attach("host")).rejects.toThrow(
      "host runtime does not support reattach"
    );
  });

  it("rejects detach because host runtime has no addressable env", async () => {
    const env = await hostExecutionEnvFactory.open(createOpenSpec());

    await expect(env.detach()).rejects.toThrow(
      "host runtime does not support detach because host has no addressable env"
    );
  });

  it("opens the configured shell through the host runner with tty enabled", async () => {
    const exec = vi.fn(() => createCompletedHandle());
    const createHostRunner = vi.fn(() => ({
      name: "host",
      exec
    }));

    vi.resetModules();
    vi.doMock("./host-runner.js", () => ({
      createHostRunner
    }));

    try {
      const { hostExecutionEnvFactory: mockedFactory } = await import("./host-execution-env.js");
      const openSpec = createOpenSpec({
        cwd: "/workspace/project",
        env: {
          PATH: "/bin",
          SHELL: "/bin/custom-shell"
        }
      });

      const env = await mockedFactory.open(openSpec);
      const handle = env.shell();

      expect(createHostRunner).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith({
        command: "/bin/custom-shell",
        cwd: "/workspace/project",
        env: openSpec.env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true
      });
      await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    } finally {
      vi.doUnmock("./host-runner.js");
      vi.resetModules();
    }
  });

  it("forwards interactive shell cwd and cancellation signal", async () => {
    const exec = vi.fn(() => createCompletedHandle());
    const createHostRunner = vi.fn(() => ({
      name: "host",
      exec
    }));
    const controller = new AbortController();
    controller.abort();

    vi.resetModules();
    vi.doMock("./host-runner.js", () => ({
      createHostRunner
    }));

    try {
      const { hostExecutionEnvFactory: mockedFactory } = await import("./host-execution-env.js");
      const env = await mockedFactory.open(
        createOpenSpec({
          cwd: "/workspace/outer",
          shellSpec: {
            command: "/bin/custom-shell",
            cwd: "/workspace/inner",
            signal: controller.signal
          }
        })
      );

      env.shell();

      expect(exec).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/workspace/inner", signal: controller.signal })
      );
    } finally {
      vi.doUnmock("./host-runner.js");
      vi.resetModules();
    }
  });

  it("ignores inherited shell spec fields", async () => {
    const exec = vi.fn(() => createCompletedHandle());
    const createHostRunner = vi.fn(() => ({
      name: "host",
      exec
    }));
    const controller = new AbortController();
    controller.abort();
    const inheritedShellSpec = Object.create({
      command: "/polluted-shell",
      args: ["--polluted"],
      cwd: "/polluted",
      env: { POLLUTED: "1" },
      signal: controller.signal
    }) as OpenSpec["shellSpec"];

    vi.resetModules();
    vi.doMock("./host-runner.js", () => ({
      createHostRunner
    }));

    try {
      const { hostExecutionEnvFactory: mockedFactory } = await import("./host-execution-env.js");
      const openSpec = createOpenSpec({
        cwd: "/workspace/project",
        env: {
          PATH: "/bin",
          SHELL: "/bin/custom-shell"
        },
        shellSpec: inheritedShellSpec
      });

      const env = await mockedFactory.open(openSpec);
      env.shell();

      expect(exec).toHaveBeenCalledWith({
        command: "/bin/custom-shell",
        cwd: "/workspace/project",
        env: openSpec.env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        tty: true
      });
    } finally {
      vi.doUnmock("./host-runner.js");
      vi.resetModules();
    }
  });
});

function createOpenSpec(overrides: Partial<OpenSpec> = {}): OpenSpec {
  return {
    cwd: process.cwd(),
    runtime: { type: "host" },
    env: process.env as Record<string, string>,
    uploadIgnoreFiles: [],
    jobLabel: {
      tool: "node",
      argv: [process.execPath]
    },
    ...overrides
  };
}

function createCompletedHandle(): RunHandle {
  return {
    pid: 123,
    stdin: null,
    stdout: null,
    stderr: null,
    result: Promise.resolve({ exitCode: 0 }),
    kill() {}
  };
}

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
