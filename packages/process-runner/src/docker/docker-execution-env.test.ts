import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
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

  it("follows appended detached log output until the command exits", async () => {
    vi.useFakeTimers();
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["first\n"] },
      { exitCode: 0, stdout: [] },
      { exitCode: 0, stdout: ["second\n"] },
      { exitCode: 0, stdout: ["0\n"] }
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

  it("preserves UTF-8 characters split across detached log polling reads", async () => {
    vi.useFakeTimers();
    const bytes = Buffer.from("🧪\n", "utf8");
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: [bytes.subarray(0, 2)] },
      { exitCode: 0, stdout: [] },
      { exitCode: 0, stdout: [bytes.subarray(2)] },
      { exitCode: 0, stdout: ["0\n"] }
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
