import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import { detectContext } from "./context.js";
import { detectEngine } from "./engine.js";
import { createHostRunner } from "../host/host-runner.js";
import type { WorkspaceTransferFileSystem } from "../workspace-transfer.js";
import type { OpenSpec, RunHandle, RunSpec, Runner } from "../types.js";

const workspaceTransferMocks = vi.hoisted(() => ({
  uploadWorkspace: vi.fn(),
  downloadWorkspace: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn(async (filePath: string) => filePath)
}));

vi.mock("./engine.js", () => ({
  detectEngine: vi.fn(() => "docker")
}));

vi.mock("./context.js", async () => {
  const actual = await vi.importActual<typeof import("./context.js")>("./context.js");

  return {
    ...actual,
    detectContext: vi.fn(() => null)
  };
});

vi.mock("../host/host-runner.js", () => ({
  createHostRunner: vi.fn()
}));

vi.mock("../workspace-transfer.js", async (importActual) => ({
  ...(await importActual<typeof import("../workspace-transfer.js")>()),
  uploadWorkspace: workspaceTransferMocks.uploadWorkspace,
  downloadWorkspace: workspaceTransferMocks.downloadWorkspace
}));

describe("dockerExecutionEnvFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectEngine).mockReturnValue("docker");
    vi.mocked(detectContext).mockReturnValue(null);
    vi.mocked(readdir).mockResolvedValue([]);
    vi.mocked(realpath).mockImplementation(async (filePath) => String(filePath));
    workspaceTransferMocks.uploadWorkspace.mockResolvedValue({ files: 0, bytes: 0, skipped: [] });
    workspaceTransferMocks.downloadWorkspace.mockResolvedValue({ files: 0, bytes: 0, conflicts: [] });
  });

  it("opens a persistent container from a configured image with runtime mounts", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["container-from-image\n"] }]);
    const state = createState(null);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");

    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "node:22",
          build_args: {},
          mounts: [{ source: "/repo", target: "/workspace", readonly: true }]
        },
        state,
        hostRunner: runner
      })
    );

    expect(env.id).toBe("container-from-image");
    expect(readFile).not.toHaveBeenCalled();
    expect(state.getCalls).toEqual([]);
    expect(state.putCalls).toEqual([]);
    expect(runner.specs[0]).toMatchObject({
      command: "docker",
      args: [
        "run",
        "-d",
        "-i",
        "--name",
        expect.stringMatching(/^poe-env-/),
        "-v",
        "/repo:/workspace:ro",
        "node:22",
        "sh",
        "-c",
        "while :; do sleep 3600; done"
      ]
    });
  });

  it("uses the configured container engine instead of auto-detecting", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0 },
      { exitCode: 0, stdout: ["podman-container\n"] }
    ]);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FROM alpine\n"));
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");

    await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          dockerfile: "Dockerfile",
          build_context: ".",
          build_args: {},
          mounts: [],
          engine: "podman"
        },
        hostRunner: runner
      })
    );

    expect(detectEngine).not.toHaveBeenCalled();
    expect(runner.specs[0]?.command).toBe("podman");
    expect(runner.specs[1]?.command).toBe("podman");
    expect(runner.specs[1]?.args?.[0]).toBe("run");
  });

  it("uses a cached dockerfile image when the template hash exists", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0 },
      { exitCode: 0, stdout: ["cached-container\n"] }
    ]);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FROM alpine\n"));
    const state = createState({
      image: "poe-code/local:cached",
      hash: "unused",
      runtime_type: "docker",
      dockerfile_path: "/repo/.poe-code/Dockerfile",
      built_at: "2026-05-03T00:00:00.000Z"
    });
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");

    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          dockerfile: ".poe-code/Dockerfile",
          build_context: ".",
          build_args: { B: "2", A: "1" },
          mounts: []
        },
        state,
        hostRunner: runner
      })
    );

    expect(env.id).toBe("cached-container");
    expect(state.getCalls).toEqual([{ backend: "docker", hash: expect.any(String) }]);
    expect(state.putCalls).toEqual([]);
    expect(runner.specs).toHaveLength(2);
    expect(runner.specs[0]?.args).toEqual(["image", "inspect", "poe-code/local:cached"]);
    expect(runner.specs[1]?.args).toContain("poe-code/local:cached");
  });

  it("rebuilds a cached dockerfile image that no longer exists", async () => {
    const runner = createCapturingRunner([
      { exitCode: 1, stderr: ["missing image\n"] },
      { exitCode: 0 },
      { exitCode: 0, stdout: ["rebuilt-container\n"] }
    ]);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FROM alpine\n"));
    const state = createState({
      image: "poe-code/local:missing",
      hash: "unused",
      runtime_type: "docker",
      dockerfile_path: "/repo/Dockerfile",
      built_at: "2026-05-03T00:00:00.000Z"
    });
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");

    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          dockerfile: "Dockerfile",
          build_context: ".",
          build_args: {},
          mounts: []
        },
        state,
        hostRunner: runner
      })
    );

    expect(env.id).toBe("rebuilt-container");
    expect(runner.specs.map((spec) => spec.args?.[0])).toEqual(["image", "build", "run"]);
    expect(state.putCalls).toHaveLength(1);
  });

  it("separates dockerfile template cache keys by engine", async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FROM alpine\n"));
    const entries = new Map<string, unknown>();
    const state = {
      templates: {
        async get(_backend: string, hash: string) {
          return entries.get(hash) ?? null;
        },
        async put(_backend: string, entry: { hash: string }) {
          entries.set(entry.hash, entry);
        }
      }
    };
    const dockerRunner = createCapturingRunner([{ exitCode: 0 }]);
    const podmanRunner = createCapturingRunner([{ exitCode: 0 }]);
    const { buildDockerRuntimeTemplate } = await import("./docker-execution-env.js");

    const docker = await buildDockerRuntimeTemplate({
      cwd: "/repo",
      runtime: { type: "docker", dockerfile: "Dockerfile", build_args: {}, engine: "docker" },
      state,
      runner: dockerRunner
    });
    const podman = await buildDockerRuntimeTemplate({
      cwd: "/repo",
      runtime: { type: "docker", dockerfile: "Dockerfile", build_args: {}, engine: "podman" },
      state,
      runner: podmanRunner
    });

    expect(docker.hash).not.toBe(podman.hash);
    expect(podman.cached).toBe(false);
    expect(podmanRunner.specs[0]?.command).toBe("podman");
  });

  it("changes the dockerfile template cache hash when build context contents change", async () => {
    const files = new Map([
      ["/repo/Dockerfile", "FROM scratch\nCOPY app.txt /app.txt\n"],
      ["/repo/context/app.txt", "one\n"]
    ]);
    vi.mocked(readFile).mockImplementation(async (filePath) => Buffer.from(files.get(String(filePath)) ?? ""));
    vi.mocked(readdir).mockResolvedValue([{ name: "app.txt", isDirectory: () => false, isFile: () => true }] as never);
    const runner = createCapturingRunner([{ exitCode: 0 }, { exitCode: 0 }]);
    const state = createState(null);
    const { buildDockerRuntimeTemplate } = await import("./docker-execution-env.js");
    const input = {
      cwd: "/repo",
      runtime: { type: "docker" as const, dockerfile: "Dockerfile", build_context: "context", build_args: {} },
      state,
      runner
    };

    await buildDockerRuntimeTemplate(input);
    files.set("/repo/context/app.txt", "two\n");
    await buildDockerRuntimeTemplate(input);

    expect(state.getCalls[0]?.hash).not.toBe(state.getCalls[1]?.hash);
  });

  it("keeps the dockerfile template cache hash stable when dockerignore-excluded files change", async () => {
    const files = new Map([
      ["/repo/Dockerfile", "FROM scratch\nCOPY app.txt /app.txt\n"],
      ["/repo/context/.dockerignore", "ignored/\n"],
      ["/repo/context/app.txt", "one\n"],
      ["/repo/context/ignored/file.txt", "ignored-one\n"]
    ]);
    vi.mocked(readFile).mockImplementation(async (filePath) =>
      Buffer.from(files.get(String(filePath)) ?? "")
    );
    vi.mocked(readdir).mockImplementation(async (dirPath) => {
      if (String(dirPath) === "/repo/context") {
        return [
          dirent(".dockerignore", "file"),
          dirent("app.txt", "file"),
          dirent("ignored", "dir")
        ] as never;
      }
      if (String(dirPath) === "/repo/context/ignored") {
        return [dirent("file.txt", "file")] as never;
      }
      return [] as never;
    });
    const runner = createCapturingRunner([{ exitCode: 0 }, { exitCode: 0 }]);
    const state = createState(null);
    const { buildDockerRuntimeTemplate } = await import("./docker-execution-env.js");
    const input = {
      cwd: "/repo",
      runtime: { type: "docker" as const, dockerfile: "Dockerfile", build_context: "context", build_args: {} },
      state,
      runner
    };

    await buildDockerRuntimeTemplate(input);
    files.set("/repo/context/ignored/file.txt", "ignored-two\n");
    await buildDockerRuntimeTemplate(input);

    expect(state.getCalls[0]?.hash).toBe(state.getCalls[1]?.hash);
  });

  it("rejects dockerfile template build contexts outside the runtime cwd", async () => {
    const runner = createCapturingRunner([{ exitCode: 0 }]);
    const { buildDockerRuntimeTemplate } = await import("./docker-execution-env.js");

    await expect(
      buildDockerRuntimeTemplate({
        cwd: "/repo/project",
        runtime: {
          type: "docker",
          dockerfile: "Dockerfile",
          build_context: "..",
          build_args: {}
        },
        runner
      })
    ).rejects.toThrow("runtime.build_context must remain inside runtime cwd /repo/project.");

    await expect(
      buildDockerRuntimeTemplate({
        cwd: "/repo/project",
        runtime: {
          type: "docker",
          dockerfile: "Dockerfile",
          build_context: "/tmp/context",
          build_args: {}
        },
        runner
      })
    ).rejects.toThrow("runtime.build_context must remain inside runtime cwd /repo/project.");
    expect(readFile).not.toHaveBeenCalled();
    expect(runner.specs).toEqual([]);
  });

  it("builds and caches a dockerfile image on template cache miss with sorted build args", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0 },
      { exitCode: 0, stdout: ["built-container\n"] }
    ]);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FROM alpine\nARG ALPHA\nARG ZED\n"));
    const state = createState(null);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");

    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          dockerfile: "Dockerfile",
          build_context: "docker",
          build_args: { ZED: "last", ALPHA: "first" },
          mounts: []
        },
        state,
        hostRunner: runner
      })
    );

    const buildSpec = runner.specs[0];
    const builtImage = state.putCalls[0]?.entry.image;

    expect(env.id).toBe("built-container");
    expect(builtImage).toMatch(/^poe-code\/local:[a-f0-9]{64}$/);
    expect(buildSpec).toEqual({
      command: "docker",
      args: [
        "build",
        "--tag",
        builtImage,
        "-f",
        "/repo/Dockerfile",
        "--build-arg",
        "ALPHA=first",
        "--build-arg",
        "ZED=last",
        "/repo/docker"
      ],
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(state.putCalls[0]?.backend).toBe("docker");
    expect(state.putCalls[0]?.entry).toMatchObject({
      hash: expect.any(String),
      image: builtImage,
      runtime_type: "docker",
      dockerfile_path: "/repo/Dockerfile"
    });
  });

  it("exposes a build helper that can force rebuilds past the template cache", async () => {
    const runner = createCapturingRunner([{ exitCode: 0 }]);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("FROM alpine\n"));
    const state = createState({
      image: "poe-code/local:cached",
      hash: "unused",
      runtime_type: "docker",
      dockerfile_path: "/repo/Dockerfile",
      built_at: "2026-05-03T00:00:00.000Z"
    });
    const { buildDockerRuntimeTemplate } = await import("./docker-execution-env.js");

    const result = await buildDockerRuntimeTemplate({
      cwd: "/repo",
      runtime: {
        type: "docker",
        dockerfile: "Dockerfile",
        build_context: ".",
        build_args: {}
      },
      state,
      runner,
      force: true
    });

    expect(result).toEqual({
      backend: "docker",
      cached: false,
      hash: expect.any(String),
      image: expect.stringMatching(/^poe-code\/local:[a-f0-9]{64}$/)
    });
    expect(runner.specs[0]).toMatchObject({
      command: "docker",
      args: ["build", "--tag", result.image, "-f", "/repo/Dockerfile", "/repo"]
    });
    expect(state.putCalls).toHaveLength(1);
  });

  it("executes commands inside the opened container", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["ok\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        hostRunner: runner
      })
    );

    const handle = env.exec({
      command: "printf",
      args: ["ok"],
      cwd: "/workspace",
      env: { A: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      tty: true
    });

    expect(runner.specs[1]).toEqual({
      command: "docker",
      args: [
        "exec",
        "-i",
        "-t",
        "-w",
        "/workspace",
        "--env-file",
        expect.stringMatching(/poe-docker-env-.+\/env$/),
        "container-id",
        "printf",
        "ok"
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      tty: true
    });
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("keeps docker exec env values out of argv", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["ok\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        hostRunner: runner
      })
    );

    const handle = env.exec({
      command: "printf",
      args: ["ok"],
      env: { SECRET_TOKEN: "sk-secret" },
      stdout: "pipe",
      stderr: "pipe"
    });
    const args = runner.specs[1]?.args ?? [];
    const envFileIndex = args.indexOf("--env-file");
    const envFilePath = args[envFileIndex + 1];

    expect(envFileIndex).toBeGreaterThanOrEqual(0);
    expect(args.join("\0")).not.toContain("sk-secret");
    expect(envFilePath).toEqual(expect.stringMatching(/poe-docker-env-.+\/env$/));
    expect(readFileSync(envFilePath ?? "", "utf8")).toBe("SECRET_TOKEN=sk-secret\n");

    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(existsSync(envFilePath ?? "")).toBe(false);
  });

  it("forwards command cancellation signals to docker exec", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 1 }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        hostRunner: runner
      })
    );
    const controller = new AbortController();
    controller.abort();

    const handle = env.exec({ command: "node", signal: controller.signal });

    expect(runner.specs[1]).toMatchObject({ signal: controller.signal });
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("uses the interactive shell working directory", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0 }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        hostRunner: runner,
        shellSpec: { command: "bash", cwd: "/interactive" }
      })
    );

    env.shell();

    expect(runner.specs[1]?.args).toContain("/interactive");
    expect(runner.specs[1]?.args).not.toContain("/repo");
  });

  it("forwards interactive shell cancellation signals to docker exec", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 1 }
    ]);
    const controller = new AbortController();
    controller.abort();
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        hostRunner: runner,
        shellSpec: { command: "bash", signal: controller.signal }
      })
    );

    const handle = env.shell();

    expect(runner.specs[1]).toMatchObject({ signal: controller.signal });
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });

  it("delegates workspace synchronization to the shared transfer policy", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        hostRunner: runner
      })
    );

    await env.uploadWorkspace();
    await env.downloadWorkspace({ conflictPolicy: "overwrite" });

    expect(workspaceTransferMocks.uploadWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo", workspaceDir: "/repo", remoteFs: expect.any(Object) }),
      { runner: undefined, workspaceExclude: [] }
    );
    expect(workspaceTransferMocks.downloadWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo", workspaceDir: "/repo", remoteFs: expect.any(Object) }),
      { conflictPolicy: "overwrite" }
    );
  });

  it("reports container workspace symlinks without following them", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["linked\tl\t0\n"] }
    ]);
    workspaceTransferMocks.downloadWorkspace.mockImplementationOnce(
      async (transferEnv: { remoteFs: WorkspaceTransferFileSystem }) => {
        const entries = await transferEnv.remoteFs.readdir("/repo", { withFileTypes: true });
        expect(entries).toHaveLength(1);
        expect(entries[0]?.name).toBe("linked");
        expect(entries[0]?.isSymbolicLink?.()).toBe(true);
        expect(entries[0]?.isDirectory()).toBe(false);
        expect(entries[0]?.isFile()).toBe(false);
        return { files: 0, bytes: 0, conflicts: [] };
      }
    );
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        hostRunner: runner
      })
    );

    await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toEqual({
      files: 0,
      bytes: 0,
      conflicts: []
    });
    expect(runner.specs[1]?.args?.at(-1)).toContain('[ -L "$item" ]');
  });

  it("skips workspace transfers when synchronization is disabled", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["container-id\n"] }]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runner: { sync: "none" },
        hostRunner: runner
      })
    );

    await expect(env.uploadWorkspace()).resolves.toEqual({ files: 0, bytes: 0, skipped: [] });
    await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toEqual({
      files: 0,
      bytes: 0,
      conflicts: []
    });
    expect(runner.specs).toHaveLength(1);
    expect(workspaceTransferMocks.uploadWorkspace).not.toHaveBeenCalled();
    expect(workspaceTransferMocks.downloadWorkspace).not.toHaveBeenCalled();
  });

  it("does not download workspace changes in upload-only mode", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["container-id\n"] }]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runner: { sync: "upload" },
        hostRunner: runner
      })
    );

    await expect(env.downloadWorkspace({ conflictPolicy: "overwrite" })).resolves.toEqual({
      files: 0,
      bytes: 0,
      conflicts: []
    });
    expect(runner.specs).toHaveLength(1);
    expect(workspaceTransferMocks.downloadWorkspace).not.toHaveBeenCalled();
  });

  it("passes upload exclusions to the shared workspace transfer policy", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        uploadIgnoreFiles: ["node_modules", "dist"],
        hostRunner: runner
      })
    );

    await env.uploadWorkspace();

    expect(workspaceTransferMocks.uploadWorkspace).toHaveBeenCalledWith(
      expect.any(Object),
      { runner: undefined, workspaceExclude: ["node_modules", "dist"] }
    );
  });

  it("passes refusal conflict policy to shared workspace transfer", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(
      createOpenSpec({
        runtime: {
          type: "docker",
          image: "alpine:latest",
          build_args: {},
          mounts: []
        },
        hostRunner: runner
      })
    );

    await env.downloadWorkspace({ conflictPolicy: "refuse" });

    expect(workspaceTransferMocks.downloadWorkspace).toHaveBeenCalledWith(
      expect.any(Object),
      { conflictPolicy: "refuse" }
    );
  });

  it("attaches to an existing container id", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["attached\n"] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id");

    const handle = env.exec({
      command: "printf",
      args: ["attached"],
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(runner.specs[0]).toEqual({
      command: "docker",
      args: ["exec", "container-id", "printf", "attached"],
      stdin: undefined,
      stdout: "pipe",
      stderr: "pipe",
      tty: undefined
    });
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
  });

  it("reattaches through the persisted container engine and context", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["attached\n"] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-1",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace",
      reattachContext: { engine: "podman", context: "colima-profile" }
    });

    env.exec({ command: "printf", args: ["attached"], stdout: "pipe", stderr: "pipe" });

    expect(detectEngine).not.toHaveBeenCalled();
    expect(runner.specs[0]?.command).toBe("podman");
    expect(runner.specs[0]?.args).not.toContain("--context");
  });

  it("reattaches through the persisted docker context", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["attached\n"] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-1",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace",
      reattachContext: { engine: "docker", context: "colima-profile" }
    });

    env.exec({ command: "printf", args: ["attached"], stdout: "pipe", stderr: "pipe" });

    expect(runner.specs[0]?.command).toBe("docker");
    expect(runner.specs[0]?.args).toEqual([
      "--context",
      "colima-profile",
      "exec",
      "container-id",
      "printf",
      "attached"
    ]);
  });

  it("preserves a persisted absence of docker context", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["attached\n"] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    vi.mocked(detectContext).mockReturnValue("colima-later");
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-1",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace",
      reattachContext: { engine: "docker", context: null }
    });

    env.exec({ command: "printf", args: ["attached"], stdout: "pipe", stderr: "pipe" });

    expect(runner.specs[0]?.args).toEqual(["exec", "container-id", "printf", "attached"]);
  });

  it("reports paused retained containers as still running", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["paused\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(createOpenSpec({ hostRunner: runner }));
    const job = await env.detach();

    await expect(job.status()).resolves.toBe("running");
  });

  it("preserves a successful docker wait exit code of zero", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 7, stdout: ["0\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(createOpenSpec({ hostRunner: runner }));
    const job = await env.detach();

    await expect(job.wait()).resolves.toEqual({ exitCode: 0 });
  });

  it("rejects malformed docker wait exit code output instead of parsing a prefix", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["0x10\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(createOpenSpec({ hostRunner: runner }));
    const job = await env.detach();

    await expect(job.wait()).rejects.toThrow(/docker wait/i);
    expect(runner.specs[1]?.args).toEqual(["wait", "container-id"]);
  });

  it("tracks an attached detached command using its completion marker", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["0\n"] },
      { exitCode: 0, stdout: ["0\n"] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-1",
      tool: "node",
      argv: ["node", "app.js"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    await expect(job.status()).resolves.toBe("exited");
    await expect(job.wait()).resolves.toEqual({ exitCode: 0 });
    expect(runner.specs[0]?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "container-id",
        "sh",
        "-c",
        expect.stringContaining("/tmp/poe-jobs/job-1.exit")
      ])
    );
    expect(runner.specs[1]?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "container-id",
        "sh",
        "-c",
        expect.stringContaining("/tmp/poe-jobs/job-1.exit")
      ])
    );
  });

  it("reports an unreachable container as lost instead of running", async () => {
    const runner = createCapturingRunner([
      { exitCode: 1, stderr: ["No such container: container-id\n"] },
      { exitCode: 1, stderr: ["No such container: container-id\n"] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-1",
      tool: "node",
      argv: ["node", "app.js"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    await expect(job.status()).resolves.toBe("lost");
    await expect(job.wait()).resolves.toEqual({ exitCode: 1 });
  });

  it("rejects malformed attached detached command completion markers", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["42abc\n"] },
      { exitCode: 0, stdout: ["0x10\n"] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-1",
      tool: "node",
      argv: ["node", "app.js"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    await expect(job.status()).rejects.toThrow("detached exit marker");
    await expect(job.wait()).rejects.toThrow("detached exit marker");
  });

  it("tracks a newly detached command using its supplied job context", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["9\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = (await dockerExecutionEnvFactory.open(
      createOpenSpec({ hostRunner: runner })
    )) as Awaited<ReturnType<typeof dockerExecutionEnvFactory.open>> & {
      setDetachedJobContext(context: { id: string; tool: string; argv: string[] }): void;
    };
    env.setDetachedJobContext({ id: "job-new", tool: "node", argv: ["node", "app.js"] });
    const job = await env.detach();

    await expect(job.wait()).resolves.toEqual({ exitCode: 9 });
    expect(job).toMatchObject({ id: "job-new", tool: "node", argv: ["node", "app.js"] });
    expect(runner.specs[1]?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "container-id",
        "sh",
        "-c",
        expect.stringContaining("/tmp/poe-jobs/job-new.exit")
      ])
    );
  });

  it("rejects detached log streaming when docker cannot read the log file", async () => {
    const runner = createCapturingRunner([{ exitCode: 75, stderr: ["container disappeared\n"] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    await expect(async () => {
      for await (const chunk of job.stream()) {
        throw new Error(`Unexpected log chunk: ${chunk.data}`);
      }
    }).rejects.toThrow("container disappeared");
  });

  it("filters detached log streaming by modification timestamp", async () => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: [] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    const chunks = [];
    for await (const chunk of job.stream({ since: new Date("2099-01-01T00:00:00.000Z") })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
    expect(runner.specs[0]?.args?.at(-1)).toContain("stat -c %Y");
    expect(runner.specs[0]?.args?.at(-1)).toContain("4070908800");
  });

  it.each(["read", "stream status", "detached status", "container status"])(
    "cancels a blocked local %s and waits for its process to close",
    async (phase) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const aborted = vi.fn();
      const closed = vi.fn();
      const settled = vi.fn();
      const specs: RunSpec[] = [];
      let release = () => {};
      const runner: Runner = {
        name: "abort-aware",
        exec(spec) {
          specs.push(spec);
          if (phase === "stream status" && specs.length === 1) {
            return createHandle({ exitCode: 0 });
          }
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          let finish!: (result: { exitCode: number }) => void;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let done = false;
          const result = new Promise<{ exitCode: number }>((resolve) => {
            finish = resolve;
          });
          const onAbort = () => {
            aborted();
            timer = setTimeout(release, 10);
          };
          release = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            spec.signal?.removeEventListener("abort", onAbort);
            stdout.end();
            stderr.end();
            finish({ exitCode: 1 });
            closed();
          };
          spec.signal?.addEventListener("abort", onAbort, { once: true });
          return { pid: 123, stdin: null, stdout, stderr, result, kill: vi.fn() };
        }
      };
      vi.mocked(createHostRunner).mockReturnValue(runner);
      const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
      const env = await dockerExecutionEnvFactory.attach(
        "container-id",
        phase === "container status"
          ? undefined
          : {
              jobId: "job-logs",
              tool: "node",
              argv: ["node"],
              cwd: "/workspace"
            }
      );
      const job = env.job ?? (await env.detach());
      const kill = vi.spyOn(job, "kill");
      const close = vi.spyOn(env, "close");
      const operation =
        phase === "read" || phase === "stream status"
          ? job.stream({ follow: true, signal: controller.signal })[Symbol.asyncIterator]().next()
          : job.status({ signal: controller.signal });
      const reading = operation.then(
        (value) => settled(value),
        (error: unknown) => settled(error)
      );
      try {
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
        expect(aborted).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10);

        expect(settled).toHaveBeenCalledExactlyOnceWith(controller.signal.reason);
        expect(closed).toHaveBeenCalledTimes(1);
        expect(kill).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(specs.at(-1)?.signal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        release();
        await vi.advanceTimersByTimeAsync(0);
        await reading;
        vi.restoreAllMocks();
        vi.useRealTimers();
      }
    }
  );

  it.each(["stdout", "stderr", "result"])(
    "preserves a local %s failure after closing all read resources",
    async (phase) => {
      vi.useFakeTimers();
      const failure = new Error(`${phase} failed`);
      const controller = new AbortController();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const aborted = vi.fn();
      const closed = vi.fn();
      const settled = vi.fn();
      let failResult!: (error: Error) => void;
      let finish!: (value: { exitCode: number }) => void;
      let release = () => {};
      const result = new Promise<{ exitCode: number }>((resolve, reject) => {
        finish = resolve;
        failResult = reject;
      });
      const runner: Runner = {
        name: "failing-reader",
        exec(spec) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let done = false;
          const onAbort = () => {
            aborted();
            timer = setTimeout(release, 10);
          };
          release = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            spec.signal?.removeEventListener("abort", onAbort);
            stdout.end();
            stderr.end();
            finish({ exitCode: 1 });
            closed();
          };
          spec.signal?.addEventListener("abort", onAbort, { once: true });
          return { pid: 123, stdin: null, stdout, stderr, result, kill: vi.fn() };
        }
      };
      vi.mocked(createHostRunner).mockReturnValue(runner);
      const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
      const env = await dockerExecutionEnvFactory.attach("container-id", {
        jobId: "job-logs",
        tool: "node",
        argv: ["node"],
        cwd: "/workspace"
      });
      const reading = env
        .job!.stream({ signal: controller.signal })
        [Symbol.asyncIterator]()
        .next()
        .then(
          (value) => settled(value),
          (error: unknown) => settled(error)
        );
      try {
        await vi.advanceTimersByTimeAsync(0);
        if (phase === "result") failResult(failure);
        else if (phase === "stdout") stdout.destroy(failure);
        else stderr.destroy(failure);
        await vi.advanceTimersByTimeAsync(0);
        expect(aborted).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10);

        expect(settled).toHaveBeenCalledExactlyOnceWith(failure);
        expect(closed).toHaveBeenCalledTimes(1);
        expect(controller.signal.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        release();
        await vi.advanceTimersByTimeAsync(0);
        await reading;
        vi.useRealTimers();
      }
    }
  );

  it("cancels the log polling sleep without another Docker command", async () => {
    vi.useFakeTimers();
    const runner = createCapturingRunner([
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0, stdout: ["0\n"] },
      { exitCode: 0 }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace"
    });
    const controller = new AbortController();
    const settled = vi.fn();
    const reading = env
      .job!.stream({ follow: true, signal: controller.signal })
      [Symbol.asyncIterator]()
      .next()
      .then(
        (value) => settled(value),
        (error: unknown) => settled(error)
      );
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(runner.specs).toHaveLength(2);
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
      expect(runner.specs).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.advanceTimersByTimeAsync(1000);
      await reading;
      vi.useRealTimers();
    }
  });

  it.each(["read", "status"])(
    "does not start a local %s with an already aborted signal",
    async (phase) => {
      const runner = createCapturingRunner([{ exitCode: 0 }]);
      vi.mocked(createHostRunner).mockReturnValue(runner);
      const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
      const env = await dockerExecutionEnvFactory.attach("container-id", {
        jobId: "job-logs",
        tool: "node",
        argv: ["node"],
        cwd: "/workspace"
      });
      const controller = new AbortController();
      controller.abort();
      const operation =
        phase === "read"
          ? env.job!.stream({ signal: controller.signal })[Symbol.asyncIterator]().next()
          : env.job!.status({ signal: controller.signal });
      await expect(operation).rejects.toBe(controller.signal.reason);
      expect(runner.specs).toEqual([]);
    }
  );

  it("follows appended detached log output until the command exits", async () => {
    vi.useFakeTimers();
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["first\n"] },
      { exitCode: 0, stdout: [] },
      { exitCode: 0, stdout: ["second\n"] },
      { exitCode: 0, stdout: ["0\n"] },
      { exitCode: 0, stdout: [] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    try {
      const chunks: string[] = [];
      const reading = (async () => {
        for await (const chunk of job.stream({ follow: true })) {
          chunks.push(chunk.data);
        }
      })();
      await vi.advanceTimersByTimeAsync(250);
      await reading;

      expect(chunks).toEqual(["first\n", "second\n"]);
      expect(runner.specs[2]?.args?.at(-1)).toContain("tail -c +7");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<{
    name: string;
    first: string | Uint8Array;
    last: string | Uint8Array;
    expected: Array<{ byteOffset: number; data: string }>;
    sinceByte?: number;
    exitCode?: number;
  }>([
    { name: "final output", first: "first\n", last: "last\n", expected: [{ byteOffset: 0, data: "first\n" }, { byteOffset: 6, data: "last\n" }] },
    { name: "empty first read", first: "", last: "last\n", expected: [{ byteOffset: 0, data: "last\n" }] },
    { name: "split UTF-8", first: Buffer.from("🧪\n").subarray(0, 2), last: Buffer.from("🧪\n").subarray(2), expected: [{ byteOffset: 0, data: "🧪\n" }] },
    { name: "nonzero exit", first: "first\n", last: "last\n", exitCode: 9, expected: [{ byteOffset: 0, data: "first\n" }, { byteOffset: 6, data: "last\n" }] },
    { name: "empty final read", first: "first\n", last: "", expected: [{ byteOffset: 0, data: "first\n" }] },
    { name: "resumed byte offset", first: "first\n", last: "last\n", sinceByte: 11, expected: [{ byteOffset: 11, data: "first\n" }, { byteOffset: 17, data: "last\n" }] }
  ])("drains exactly one post-exit read for $name", async ({ first, last, expected, sinceByte = 0, exitCode = 0 }) => {
    vi.useFakeTimers();
    try {
      const runner = createCapturingRunner([
        { exitCode: 0, stdout: [first] },
        { exitCode: 0, stdout: [`${exitCode}\n`] },
        { exitCode: 0, stdout: [last] }
      ]);
      vi.mocked(createHostRunner).mockReturnValue(runner);
      const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
      const env = await dockerExecutionEnvFactory.attach("container-id", {
        jobId: "job-logs", tool: "node", argv: ["node"], cwd: "/workspace"
      });
      const job = env.job;
      if (job === null) {
        throw new Error("Expected attached Docker job.");
      }
      const reading = (async () => {
        const chunks = [];
        for await (const chunk of job.stream({ follow: true, sinceByte })) {
          chunks.push(chunk);
        }
        return chunks;
      })();
      const [chunks] = await Promise.all([reading, vi.runAllTimersAsync()]);
      expect(chunks).toEqual(expected);

      expect(runner.specs).toHaveLength(3);
      expect(runner.specs[0]?.args?.at(-1)).toContain(`tail -c +${sinceByte + 1}`);
      expect(runner.specs[1]?.args?.at(-1)).toContain("/tmp/poe-jobs/job-logs.exit");
      expect(runner.specs[2]?.args?.at(-1)).toContain(`tail -c +${sinceByte + Buffer.byteLength(first) + 1}`);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, undefined])("reads one detached snapshot without polling (follow: %s)", async (follow) => {
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["snapshot\n"] }]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs", tool: "node", argv: ["node"], cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }
    const chunks = [];
    for await (const chunk of job.stream({ follow, sinceByte: 4 })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ byteOffset: 4, data: "snapshot\n" }]);
    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0]?.args?.at(-1)).toContain("tail -c +5");
  });

  it("does not read again when the detached job is lost", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["first\n"] },
      { exitCode: 1, stderr: ["No such container\n"] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs", tool: "node", argv: ["node"], cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }
    const chunks = [];
    for await (const chunk of job.stream({ follow: true })) {
      chunks.push(chunk.data);
    }

    expect(chunks).toEqual(["first\n"]);
    expect(runner.specs).toHaveLength(2);
  });

  it("preserves container-level follow termination without a detached job", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["first\n"] },
      { exitCode: 0, stdout: ["exited\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(createOpenSpec({ hostRunner: runner }));
    const job = await env.detach();
    const chunks = [];
    for await (const chunk of job.stream({ follow: true })) {
      chunks.push(chunk.data);
    }

    expect(chunks).toEqual(["first\n"]);
    expect(runner.specs).toHaveLength(3);
    expect(runner.specs[2]?.args?.[0]).toBe("inspect");
  });

  it("propagates a failed final detached log read without retrying", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["first\n"] },
      { exitCode: 0, stdout: ["0\n"] },
      { exitCode: 75, stderr: ["final log unavailable\n"] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs", tool: "node", argv: ["node"], cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }
    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of job.stream({ follow: true })) {
        chunks.push(chunk.data);
      }
    }).rejects.toThrow("final log unavailable");

    expect(chunks).toEqual(["first\n"]);
    expect(runner.specs).toHaveLength(3);
  });

  it("preserves UTF-8 characters split across detached log polling reads", async () => {
    vi.useFakeTimers();
    const bytes = Buffer.from("🧪\n", "utf8");
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: [bytes.subarray(0, 2)] },
      { exitCode: 0, stdout: [] },
      { exitCode: 0, stdout: [bytes.subarray(2)] },
      { exitCode: 0, stdout: ["0\n"] },
      { exitCode: 0, stdout: [] }
    ]);
    vi.mocked(createHostRunner).mockReturnValue(runner);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.attach("container-id", {
      jobId: "job-logs",
      tool: "node",
      argv: ["node"],
      cwd: "/workspace"
    });
    const job = env.job;
    if (job === null) {
      throw new Error("Expected attached Docker job.");
    }

    try {
      const chunks: Array<{ byteOffset: number; data: string }> = [];
      const reading = (async () => {
        for await (const chunk of job.stream({ follow: true })) {
          chunks.push(chunk);
        }
      })();
      await vi.advanceTimersByTimeAsync(250);
      await reading;

      expect(chunks).toEqual([{ byteOffset: 0, data: "🧪\n" }]);
      expect(runner.specs[2]?.args?.at(-1)).toContain("tail -c +3");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createOpenSpec(overrides: Partial<OpenSpec> = {}): OpenSpec {
  return {
    cwd: "/repo",
    runtime: {
      type: "docker",
      image: "alpine:latest",
      build_args: {},
      mounts: []
    },
    env: {},
    uploadIgnoreFiles: [],
    jobLabel: {
      tool: "node",
      argv: ["node", "--version"]
    },
    ...overrides
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

function dirent(name: string, type: "dir" | "file") {
  return {
    name,
    isDirectory: () => type === "dir",
    isFile: () => type === "file"
  };
}

function createCapturingRunner(
  results: Array<{ exitCode: number; stdout?: Array<string | Uint8Array>; stderr?: Array<string | Uint8Array> }>
): Runner & { specs: RunSpec[] } {
  const specs: RunSpec[] = [];
  const runner: Runner & { specs: RunSpec[] } = {
    name: "mock",
    specs,
    exec(spec) {
      const result = results.shift();
      if (!result) {
        throw new Error(`No mock result for ${spec.command}`);
      }

      specs.push(spec);
      return createHandle(result);
    }
  };

  return runner;
}

function createHandle(result: {
  exitCode: number;
  stdout?: Array<string | Uint8Array>;
  stderr?: Array<string | Uint8Array>;
}): RunHandle {
  return {
    pid: 123,
    stdin: null,
    stdout: result.stdout ? ReadableStreamFrom(result.stdout) : null,
    stderr: result.stderr ? ReadableStreamFrom(result.stderr) : null,
    result: Promise.resolve({ exitCode: result.exitCode }),
    kill() {}
  };
}

function ReadableStreamFrom(chunks: Array<string | Uint8Array>): NodeJS.ReadableStream {
  return Readable.from(chunks);
}
