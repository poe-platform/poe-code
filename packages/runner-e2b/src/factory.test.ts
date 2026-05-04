import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOrResolveTemplate } from "./template-build.js";
import { createSandbox, connectSandbox } from "./sdk.js";

vi.mock("./template-build.js", () => ({
  buildOrResolveTemplate: vi.fn()
}));

vi.mock("./sdk.js", () => ({
  createSandbox: vi.fn(),
  connectSandbox: vi.fn()
}));

describe("e2bExecutionEnvFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.E2B_API_KEY;
    delete process.env.CUSTOM_E2B_API_KEY;
    vi.mocked(buildOrResolveTemplate).mockResolvedValue({
      templateId: "tmpl_built",
      cached: false
    });
    vi.mocked(createSandbox).mockResolvedValue(createSandboxMock("sb_open"));
    vi.mocked(connectSandbox).mockResolvedValue(createSandboxMock("sb_attached"));
  });

  it("opens a sandbox from a direct template id and runtime api key env", async () => {
    process.env.CUSTOM_E2B_API_KEY = "key_from_env";
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    const env = await e2bExecutionEnvFactory.open({
      cwd: "/repo",
      runtime: {
        type: "e2b",
        template_id: "tmpl_configured",
        build_args: {},
        mounts: [],
        api_key_env: "CUSTOM_E2B_API_KEY",
        timeout_minutes: 30
      },
      env: { NODE_ENV: "test" },
      uploadIgnoreFiles: [],
      jobLabel: { tool: "node", argv: ["node", "--version"] }
    });

    expect(env.id).toBe("sb_open");
    expect(buildOrResolveTemplate).not.toHaveBeenCalled();
    expect(createSandbox).toHaveBeenCalledWith({
      apiKey: "key_from_env",
      templateId: "tmpl_configured",
      env: { NODE_ENV: "test" },
      timeoutMinutes: 30
    });
  });

  it("prefers auth.providers.e2b over runtime api key env", async () => {
    process.env.E2B_API_KEY = "key_from_env";
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    await e2bExecutionEnvFactory.open({
      cwd: "/repo",
      runtime: {
        type: "e2b",
        template_id: "tmpl_configured",
        build_args: {},
        mounts: []
      },
      auth: { providers: { e2b: { api_key: "key_from_auth" } } },
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: { tool: "node", argv: ["node"] }
    } as Parameters<typeof e2bExecutionEnvFactory.open>[0]);

    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "key_from_auth" })
    );
  });

  it("builds a template when template_id is absent", async () => {
    process.env.E2B_API_KEY = "key_from_env";
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
      apiKey: "key_from_env"
    });
    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: "tmpl_built" })
    );
  });

  it("attaches to an existing sandbox id", async () => {
    process.env.E2B_API_KEY = "key_from_env";
    const { e2bExecutionEnvFactory } = await import("./factory.js");

    const env = await e2bExecutionEnvFactory.attach("sb_existing");

    expect(env.id).toBe("sb_attached");
    expect(connectSandbox).toHaveBeenCalledWith("sb_existing", "key_from_env");
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
