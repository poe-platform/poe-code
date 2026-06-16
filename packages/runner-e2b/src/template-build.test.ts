import { readdir, readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTemplate } from "./sdk.js";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn()
}));

vi.mock("./sdk.js", () => ({
  buildTemplate: vi.fn()
}));

describe("buildE2bRuntimeTemplate", () => {
  const files = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    files.clear();
    files.set("/repo/Dockerfile", "FROM node:22\n");
    files.set("/repo/package.json", "{\"name\":\"test\"}\n");
    files.set("/repo/src/index.js", "console.log('one')\n");
    vi.mocked(readFile).mockImplementation(async (filePath) => {
      const contents = files.get(String(filePath));
      if (contents === undefined) {
        throw Object.assign(new Error(`ENOENT: ${String(filePath)}`), { code: "ENOENT" });
      }
      return Buffer.from(contents);
    });
    vi.mocked(readdir).mockImplementation(async (dirPath) => {
      if (String(dirPath) === "/repo") {
        return [dirent("Dockerfile", "file"), dirent("package.json", "file"), dirent("src", "dir")];
      }
      if (String(dirPath) === "/repo/src") {
        return [dirent("index.js", "file")];
      }
      return [];
    });
    vi.mocked(buildTemplate).mockResolvedValue({ templateId: "tmpl_built" });
  });

  it("uses the cached E2B template for matching dockerfile and build args", async () => {
    const state = createState({
      hash: "unused",
      template_id: "tmpl_cached",
      runtime_type: "e2b",
      dockerfile_path: "/repo/Dockerfile",
      built_at: "2026-05-03T00:00:00.000Z"
    });
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    const result = await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: {
        type: "e2b",
        build_args: { ZED: "last", ALPHA: "first" },
        mounts: []
      },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });

    expect(result).toEqual({
      backend: "e2b",
      hash: expect.any(String),
      templateId: "tmpl_cached",
      cached: true
    });
    expect(state.getCalls).toEqual([{ backend: "e2b", hash: expect.any(String) }]);
    expect(buildTemplate).not.toHaveBeenCalled();
  });

  it("builds and caches an E2B template on cache miss", async () => {
    const state = createState(null);
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    const result = await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: {
        type: "e2b",
        build_args: { A: "1" },
        mounts: [],
        cpu: 4,
        memory_mb: 4096
      },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });

    expect(result).toEqual({
      backend: "e2b",
      hash: expect.any(String),
      templateId: "tmpl_built",
      cached: false
    });
    expect(buildTemplate).toHaveBeenCalledWith({
      apiKey: "e2b_key",
      name: expect.stringMatching(/^poe-code-[a-f0-9]{32}$/),
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      cpu: 4,
      memoryMb: 4096,
      onLog: expect.any(Function)
    });
    expect(state.putCalls[0]).toMatchObject({
      backend: "e2b",
      entry: {
        hash: expect.any(String),
        template_id: "tmpl_built",
        runtime_type: "e2b",
        dockerfile_path: "/repo/Dockerfile"
      }
    });
  });

  it("rebuilds when force is true even when a cached template exists", async () => {
    const state = createState({
      hash: "unused",
      template_id: "tmpl_cached",
      runtime_type: "e2b",
      dockerfile_path: "/repo/Dockerfile",
      built_at: "2026-05-03T00:00:00.000Z"
    });
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    const result = await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: { type: "e2b", build_args: {}, mounts: [] },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state,
      force: true
    });

    expect(result.cached).toBe(false);
    expect(result.templateId).toBe("tmpl_built");
    expect(buildTemplate).toHaveBeenCalledTimes(1);
  });

  it("changes the template cache hash when build context file contents change", async () => {
    const state = createState(null);
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: {
        type: "e2b",
        build_args: {},
        mounts: []
      },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });
    files.set("/repo/src/index.js", "console.log('two')\n");
    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: {
        type: "e2b",
        build_args: {},
        mounts: []
      },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });

    expect(state.getCalls[0]?.hash).not.toBe(state.getCalls[1]?.hash);
  });

  it("keeps the template cache hash stable when dockerignore-excluded files change", async () => {
    files.set("/repo/.dockerignore", "ignored/\n");
    files.set("/repo/ignored/file.txt", "ignored-one\n");
    vi.mocked(readdir).mockImplementation(async (dirPath) => {
      if (String(dirPath) === "/repo") {
        return [
          dirent(".dockerignore", "file"),
          dirent("Dockerfile", "file"),
          dirent("package.json", "file"),
          dirent("ignored", "dir"),
          dirent("src", "dir")
        ];
      }
      if (String(dirPath) === "/repo/ignored") {
        return [dirent("file.txt", "file")];
      }
      if (String(dirPath) === "/repo/src") {
        return [dirent("index.js", "file")];
      }
      return [];
    });
    const state = createState(null);
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: { type: "e2b", build_args: {}, mounts: [] },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });
    files.set("/repo/ignored/file.txt", "ignored-two\n");
    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: { type: "e2b", build_args: {}, mounts: [] },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });

    expect(state.getCalls[0]?.hash).toBe(state.getCalls[1]?.hash);
  });

  it("changes the template cache hash when the base template changes", async () => {
    const state = createState(null);
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: { type: "e2b", from_template: "base-alpha", build_args: {}, mounts: [] },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });
    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: { type: "e2b", from_template: "base-beta", build_args: {}, mounts: [] },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state
    });

    expect(state.getCalls[0]?.hash).not.toBe(state.getCalls[1]?.hash);
  });

  it("appends the captured build log tail when buildTemplate throws", async () => {
    vi.mocked(buildTemplate).mockImplementation(async (opts) => {
      opts.onLog?.({ level: "info", message: "Step 1/3 : FROM node:22", timestamp: new Date() });
      opts.onLog?.({ level: "info", message: "Step 2/3 : RUN npm i -g poe-code", timestamp: new Date() });
      opts.onLog?.({ level: "error", message: "npm ERR! 404 Not Found", timestamp: new Date() });
      throw new Error("failed to run command 'npm i -g poe-code': exit status 1");
    });
    const state = createState(null);
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    await expect(
      buildE2bRuntimeTemplate({
        apiKey: "e2b_key",
        runtime: { type: "e2b", build_args: {}, mounts: [] },
        dockerfilePath: "/repo/Dockerfile",
        buildContext: "/repo",
        state
      })
    ).rejects.toThrow(/Last build output:[\s\S]*npm ERR! 404 Not Found/);
  });

  it("forwards onLog entries to the caller", async () => {
    const seen: string[] = [];
    vi.mocked(buildTemplate).mockImplementation(async (opts) => {
      opts.onLog?.({ level: "info", message: "step a", timestamp: new Date() });
      opts.onLog?.({ level: "info", message: "step b", timestamp: new Date() });
      return { templateId: "tmpl_built" };
    });
    const state = createState(null);
    const { buildE2bRuntimeTemplate } = await import("./template-build.js");

    await buildE2bRuntimeTemplate({
      apiKey: "e2b_key",
      runtime: { type: "e2b", build_args: {}, mounts: [] },
      dockerfilePath: "/repo/Dockerfile",
      buildContext: "/repo",
      state,
      onLog: (entry) => {
        seen.push(entry.message);
      }
    });

    expect(seen).toEqual(["step a", "step b"]);
  });
});

function dirent(name: string, type: "dir" | "file") {
  return {
    name,
    isDirectory: () => type === "dir",
    isFile: () => type === "file"
  };
}

function createState(template: unknown) {
  const getCalls: Array<{ backend: string; hash: string }> = [];
  const putCalls: Array<{ backend: string; entry: Record<string, unknown> }> = [];

  return {
    getCalls,
    putCalls,
    templates: {
      async get(backend: string, hash: string) {
        getCalls.push({ backend, hash });
        return template;
      },
      async put(backend: string, entry: Record<string, unknown>) {
        putCalls.push({ backend, entry });
      }
    }
  };
}
