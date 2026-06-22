import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTemplate } from "./sdk.js";

const e2b = vi.hoisted(() => {
  const template = {
    fromDockerfile: vi.fn(),
    fromTemplate: vi.fn()
  };
  template.fromDockerfile.mockReturnValue(template);
  template.fromTemplate.mockReturnValue(template);

  const Template = vi.fn(() => template) as unknown as {
    (opts: { fileContextPath: string }): typeof template;
    build: ReturnType<typeof vi.fn>;
  };
  Template.build = vi.fn();

  return { Template, template };
});

vi.mock("e2b", () => ({
  Template: e2b.Template
}));

describe("runner-e2b SDK wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    e2b.template.fromDockerfile.mockReturnValue(e2b.template);
    e2b.template.fromTemplate.mockReturnValue(e2b.template);
  });

  it("adapts E2B template build logs into a template id result", async () => {
    const seenLogs: string[] = [];
    e2b.Template.build.mockImplementation(async (_template, opts) => {
      opts.onBuildLogs({
        level: "info",
        message: "Template created with ID: tmpl_node18, Build ID: build_123",
        timestamp: new Date("2026-06-22T00:00:00.000Z")
      });
    });

    const result = await buildTemplate({
      apiKey: "e2b_key",
      name: "poe-code-test",
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      cpu: 4,
      memoryMb: 2048,
      fromTemplate: "base-template",
      onLog: (entry) => {
        seenLogs.push(entry.message);
      }
    });

    expect(result).toEqual({ templateId: "tmpl_node18" });
    expect(e2b.Template).toHaveBeenCalledWith({ fileContextPath: "/repo" });
    expect(e2b.template.fromDockerfile).toHaveBeenCalledWith("/repo/Dockerfile");
    expect(e2b.template.fromTemplate).toHaveBeenCalledWith("base-template");
    expect(e2b.Template.build).toHaveBeenCalledWith(e2b.template, {
      apiKey: "e2b_key",
      alias: "poe-code-test",
      cpuCount: 4,
      memoryMB: 2048,
      onBuildLogs: expect.any(Function)
    });
    expect(seenLogs).toEqual(["Template created with ID: tmpl_node18, Build ID: build_123"]);
  });
});
