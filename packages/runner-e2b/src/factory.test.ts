import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOrResolveTemplate } from "./template-build.js";
import { createSandbox, connectSandbox } from "./sdk.js";
import { resolveE2bApiKey } from "./auth-scope.js";

vi.mock("./template-build.js", () => ({
  buildOrResolveTemplate: vi.fn()
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
    vi.mocked(buildOrResolveTemplate).mockResolvedValue({
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
    expect(buildOrResolveTemplate).not.toHaveBeenCalled();
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

    expect(buildOrResolveTemplate).toHaveBeenCalledWith({
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
