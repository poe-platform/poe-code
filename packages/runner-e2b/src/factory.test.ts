import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildE2bRuntimeTemplate } from "./template-build.js";
import { createSandbox, connectSandbox } from "./sdk.js";
import { resolveE2bApiKey } from "./auth-scope.js";

vi.mock("./template-build.js", () => ({
  buildE2bRuntimeTemplate: vi.fn()
}));

vi.mock("./sdk.js", () => ({
  createSandbox: vi.fn(),
  connectSandbox: vi.fn()
}));

vi.mock("./auth-scope.js", () => ({
  resolveE2bApiKey: vi.fn()
}));

describe("e2bExecutionEnvFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildE2bRuntimeTemplate).mockResolvedValue({
      backend: "e2b",
      hash: "h",
      templateId: "tmpl_built",
      cached: false
    });
    vi.mocked(createSandbox).mockResolvedValue(createSandboxMock("sb_open"));
    vi.mocked(connectSandbox).mockResolvedValue(createSandboxMock("sb_attached"));
    vi.mocked(resolveE2bApiKey).mockResolvedValue("resolved_key");
  });

  it("opens a sandbox from a direct template id and resolved api key", async () => {
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    const env = await e2bExecutionEnvFactory.open({
      cwd: "/repo",
      runtime: {
        type: "e2b",
        template_id: "tmpl_configured",
        build_args: {},
        mounts: [],
        timeout_minutes: 30
      },
      env: { NODE_ENV: "test" },
      uploadIgnoreFiles: [],
      jobLabel: { tool: "node", argv: ["node", "--version"] }
    });

    expect(env.id).toBe("sb_open");
    expect(resolveE2bApiKey).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(buildE2bRuntimeTemplate).not.toHaveBeenCalled();
    expect(createSandbox).toHaveBeenCalledWith({
      apiKey: "resolved_key",
      templateId: "tmpl_configured",
      env: { NODE_ENV: "test" },
      timeoutMinutes: 30
    });
  });

  it("builds a template when template_id is absent", async () => {
    const state = { templates: { get: vi.fn(), put: vi.fn() }, jobs: {} };
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    await e2bExecutionEnvFactory.open({
      cwd: "/repo",
      runtime: {
        type: "e2b",
        dockerfile: "Dockerfile",
        build_context: "sandbox",
        build_args: {},
        mounts: []
      },
      state: state as Parameters<typeof e2bExecutionEnvFactory.open>[0]["state"],
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: { tool: "node", argv: ["node"] }
    });

    expect(buildE2bRuntimeTemplate).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ type: "e2b" }),
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo/sandbox",
      state,
      apiKey: "resolved_key"
    });
    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "tmpl_built" })
    );
  });

  it("rejects runtime mounts because E2B does not support host mounts", async () => {
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    await expect(
      e2bExecutionEnvFactory.open({
        cwd: "/repo",
        runtime: {
          type: "e2b",
          template_id: "tmpl_configured",
          build_args: {},
          mounts: [{ source: "/host/data", target: "/data", readonly: true }]
        },
        env: {},
        uploadIgnoreFiles: [],
        jobLabel: { tool: "node", argv: ["node"] }
      })
    ).rejects.toThrow("E2B runtime mounts are not supported");

    expect(resolveE2bApiKey).not.toHaveBeenCalled();
    expect(createSandbox).not.toHaveBeenCalled();
  });

  it("exposes configured values needed to reattach a detached sandbox", async () => {
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    const env = await e2bExecutionEnvFactory.open({
      cwd: "/repo",
      runtimeCwd: "/runtime-config",
      runtime: {
        type: "e2b",
        template_id: "tmpl_configured",
        build_args: {},
        mounts: [],
        workspace_dir: "/sandbox/project",
        preserve_after_exit_hours: 2
      },
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: { tool: "node", argv: ["node"] }
    });

    expect(env.reattachContext).toEqual({
      runtimeCwd: "/runtime-config",
      workspaceDir: "/sandbox/project",
      preserveAfterExitHours: 2
    });
  });

  it("attaches to an existing sandbox id", async () => {
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    const env = await e2bExecutionEnvFactory.attach("sb_existing", {
      cwd: "/repo",
      jobId: "job_1",
      tool: "node",
      argv: ["node"]
    });

    expect(env.id).toBe("sb_attached");
    expect(resolveE2bApiKey).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(connectSandbox).toHaveBeenCalledWith("sb_existing", "resolved_key");
  });

  it("restores persisted runtime context when attaching", async () => {
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    const env = await e2bExecutionEnvFactory.attach("sb_existing", {
      cwd: "/repo",
      jobId: "job_1",
      tool: "node",
      argv: ["node"],
      reattachContext: {
        runtimeCwd: "/runtime-config",
        workspaceDir: "/sandbox/project",
        preserveAfterExitHours: 2
      }
    });

    expect(resolveE2bApiKey).toHaveBeenCalledWith({ cwd: "/runtime-config" });
    expect(env.reattachContext).toEqual({
      runtimeCwd: "/runtime-config",
      workspaceDir: "/sandbox/project",
      preserveAfterExitHours: 2
    });
    const sandbox = await vi.mocked(connectSandbox).mock.results[0]?.value;
    sandbox.commands.run.mockResolvedValue({
      pid: 123,
      wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
      kill: vi.fn()
    });
    env.exec({ command: "pwd", cwd: "/repo" });

    expect(sandbox.commands.run).toHaveBeenCalledWith(
      "'pwd'",
      expect.objectContaining({ cwd: "/sandbox/project" })
    );
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached E2B job.");
    }
    sandbox.files.read.mockResolvedValue(Buffer.from("0\n"));

    await job.wait();

    expect(sandbox.setTimeout).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
  });
});

function createSandboxMock(id: string) {
  return {
    sandboxId: id,
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
      watchDir: vi.fn()
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
