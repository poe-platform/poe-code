import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { detectEngine } from "./engine.js";
import { createHostRunner } from "../host/host-runner.js";
import type { OpenSpec, RunHandle, RunSpec, Runner } from "../types.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn()
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

describe("dockerExecutionEnvFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectEngine).mockReturnValue("docker");
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
    const runner = createCapturingRunner([{ exitCode: 0, stdout: ["cached-container\n"] }]);
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
    expect(runner.specs).toHaveLength(1);
    expect(runner.specs[0]?.args).toContain("poe-code/local:cached");
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
      args: ["exec", "-i", "-t", "-w", "/workspace", "-e", "A=1", "container-id", "printf", "ok"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      tty: true
    });
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
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

  it("uploads and downloads the workspace through docker cp tarballs", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 }
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

    expect(runner.specs.map((spec) => [spec.command, spec.args?.[0], spec.args?.[1]])).toEqual([
      ["docker", "run", "-d"],
      ["tar", "-cf", expect.any(String)],
      ["docker", "cp", expect.stringContaining(".tar")],
      ["docker", "exec", "container-id"],
      ["docker", "exec", "container-id"],
      ["docker", "cp", expect.stringContaining("container-id:")],
      ["tar", "-xf", expect.any(String)]
    ]);
  });

  it("passes upload ignore files to the host tar command in configured order", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 }
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

    expect(runner.specs[1]).toMatchObject({
      command: "tar",
      args: [
        "--exclude",
        "node_modules",
        "--exclude",
        "dist",
        "-cf",
        expect.any(String),
        "-C",
        "/repo",
        "."
      ]
    });
  });

  it("refuses local overwrites on download when conflict policy is refuse", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0 },
      { exitCode: 0 },
      { exitCode: 0 }
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

    expect(runner.specs[3]).toMatchObject({
      command: "tar",
      args: ["-xkf", expect.any(String), "-C", "/repo"]
    });
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
      expect.arrayContaining(["exec", "container-id", "sh", "-c", expect.stringContaining("/tmp/poe-jobs/job-1.exit")])
    );
    expect(runner.specs[1]?.args).toEqual(
      expect.arrayContaining(["exec", "container-id", "sh", "-c", expect.stringContaining("/tmp/poe-jobs/job-1.exit")])
    );
  });

  it("tracks a newly detached command using its supplied job context", async () => {
    const runner = createCapturingRunner([
      { exitCode: 0, stdout: ["container-id\n"] },
      { exitCode: 0, stdout: ["9\n"] }
    ]);
    const { dockerExecutionEnvFactory } = await import("./docker-execution-env.js");
    const env = await dockerExecutionEnvFactory.open(createOpenSpec({ hostRunner: runner })) as Awaited<ReturnType<typeof dockerExecutionEnvFactory.open>> & {
      setDetachedJobContext(context: { id: string; tool: string; argv: string[] }): void;
    };
    env.setDetachedJobContext({ id: "job-new", tool: "node", argv: ["node", "app.js"] });
    const job = await env.detach();

    await expect(job.wait()).resolves.toEqual({ exitCode: 9 });
    expect(job).toMatchObject({ id: "job-new", tool: "node", argv: ["node", "app.js"] });
    expect(runner.specs[1]?.args).toEqual(
      expect.arrayContaining(["exec", "container-id", "sh", "-c", expect.stringContaining("/tmp/poe-jobs/job-new.exit")])
    );
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
  results: Array<{ exitCode: number; stdout?: string[]; stderr?: string[] }>
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
  stdout?: string[];
  stderr?: string[];
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

function ReadableStreamFrom(chunks: string[]): NodeJS.ReadableStream {
  return Readable.from(chunks);
}
