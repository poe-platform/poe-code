import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { readDockerBuildContextFiles } from "./docker/build-context.js";
import { buildContextArgs, detectContext } from "./docker/context.js";
import { detectEngine, isEngineAvailable } from "./docker/engine.js";
import { createDockerRunner } from "./docker/docker-runner.js";
import {
  buildDockerRuntimeTemplate,
  dockerExecutionEnvFactory
} from "./docker/docker-execution-env.js";
import { hostExecutionEnvFactory } from "./host/host-execution-env.js";
import { createHostRunner } from "./host/host-runner.js";
import { createMockRunner, createMockRunnerByCommand } from "./testing/index.js";
import type {
  DownloadResult,
  DockerMount,
  DockerPortMapping,
  DockerRunArgs,
  DockerRunnerOptions,
  Engine,
  ExecutionState,
  ExecutionEnvFactory,
  HostRunnerOptions,
  JobHandle,
  MockRunBehavior,
  OpenedEnv,
  OpenSpec,
  RunHandle,
  Runner,
  RunSpec,
  TemplateEntry,
  UploadResult
} from "@poe-code/process-runner";

describe("@poe-code/process-runner public exports", () => {
  it("exports the package type surface", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const handle: RunHandle = {
      pid: 123,
      stdout,
      stderr,
      stdin,
      result: Promise.resolve({ exitCode: 0 }),
      kill() {}
    };
    const spec: RunSpec = {
      command: "node",
      args: ["--version"],
      cwd: "/repo",
      env: {
        PATH: "/usr/bin"
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      tty: true,
      signal: new AbortController().signal,
      killProcessGroup: true
    };
    const hostOptions: HostRunnerOptions = {
      detached: true
    };
    const engine: Engine = "docker";
    const mount: DockerMount = {
      source: "/repo",
      target: "/workspace",
      readonly: true
    };
    const port: DockerPortMapping = {
      host: 3000,
      container: 3000,
      protocol: "tcp"
    };
    const dockerOptions: DockerRunnerOptions = {
      image: "node:22",
      engine,
      context: "colima",
      mounts: [mount],
      ports: [port],
      network: "bridge",
      extraArgs: ["--pull=never"],
      containerName: "process-runner-test"
    };
    const dockerArgs: DockerRunArgs = {
      engine,
      context: dockerOptions.context ?? null,
      image: dockerOptions.image,
      command: spec.command,
      args: spec.args ?? [],
      cwd: spec.cwd,
      env: spec.env,
      mounts: dockerOptions.mounts ?? [],
      ports: dockerOptions.ports ?? [],
      network: dockerOptions.network,
      containerName: dockerOptions.containerName ?? "generated-name",
      detached: hostOptions.detached ?? false,
      interactive: spec.stdin === "pipe",
      tty: spec.tty ?? false,
      rm: true,
      extraArgs: dockerOptions.extraArgs ?? []
    };
    const behavior: MockRunBehavior = {
      pid: 42,
      exitCode: 0,
      exitAfterMs: 0,
      stdout: ["ok"],
      stderr: ["warn"],
      stdoutInterval: 10
    };
    const templateEntry: TemplateEntry = {
      hash: "hash",
      image: "poe-code/local:hash",
      runtime_type: "docker",
      dockerfile_path: "/repo/Dockerfile",
      built_at: "2026-05-03T00:00:00.000Z"
    };
    const state: ExecutionState = {
      templates: {
        async get() {
          return templateEntry;
        },
        async put() {}
      }
    };
    const runner: Runner = {
      name: "host",
      exec() {
        return handle;
      }
    };
    const openSpec: OpenSpec = {
      cwd: "/repo",
      runtime: { type: "host" },
      state,
      hostRunner: runner,
      env: {},
      uploadIgnoreFiles: [],
      jobLabel: {
        tool: "node",
        argv: ["node", "--version"]
      }
    };
    const upload: UploadResult = {
      files: 0,
      bytes: 0,
      skipped: []
    };
    const download: DownloadResult = {
      files: 0,
      bytes: 0,
      conflicts: []
    };
    const job: JobHandle = {
      id: "job",
      envId: "host",
      tool: "node",
      argv: ["node"],
      async status() {
        return "running";
      },
      async *stream() {},
      async wait() {
        return { exitCode: 0 };
      },
      async kill() {}
    };
    const opened: OpenedEnv = {
      id: "host",
      job,
      async uploadWorkspace() {
        return upload;
      },
      async downloadWorkspace() {
        return download;
      },
      exec() {
        return handle;
      },
      async detach() {
        return job;
      },
      shell() {
        return handle;
      },
      async close() {}
    };
    const factory: ExecutionEnvFactory = {
      type: "host",
      async open() {
        return opened;
      },
      async attach() {
        return opened;
      }
    };

    expect(runner.exec(spec)).toBe(handle);
    await expect(factory.open(openSpec)).resolves.toBe(opened);
    await expect(opened.uploadWorkspace()).resolves.toBe(upload);
    await expect(opened.downloadWorkspace({ conflictPolicy: "refuse" })).resolves.toBe(download);
    await expect(handle.result).resolves.toEqual({ exitCode: 0 });
    expect(dockerArgs.mounts[0]).toEqual(mount);
    expect(behavior.stdout).toEqual(["ok"]);
  });

  it("keeps type-only exports out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("RunHandle");
    expect(api).not.toHaveProperty("Runner");
    expect(api).not.toHaveProperty("DockerRunnerOptions");
    expect(api).not.toHaveProperty("MockRunBehavior");
    expect(api.buildContextArgs).toBe(buildContextArgs);
    expect(api.detectContext).toBe(detectContext);
    expect(api.readDockerBuildContextFiles).toBe(readDockerBuildContextFiles);
    expect(api.detectEngine).toBe(detectEngine);
    expect(api.isEngineAvailable).toBe(isEngineAvailable);
    expect(api.buildDockerRuntimeTemplate).toBe(buildDockerRuntimeTemplate);
    expect(api.dockerExecutionEnvFactory).toBe(dockerExecutionEnvFactory);
    expect(api.hostExecutionEnvFactory).toBe(hostExecutionEnvFactory);
    expect(api.createHostRunner).toBe(createHostRunner);
    expect(api.createDockerRunner).toBe(createDockerRunner);
    expect(api.createMockRunner).toBe(createMockRunner);
    expect(api.createMockRunnerByCommand).toBe(createMockRunnerByCommand);
    expect(Object.keys(api)).toEqual([
      "buildContextArgs",
      "detectContext",
      "readDockerBuildContextFiles",
      "detectEngine",
      "isEngineAvailable",
      "createDockerRunner",
      "buildDockerRuntimeTemplate",
      "dockerExecutionEnvFactory",
      "hostExecutionEnvFactory",
      "createHostRunner",
      "createMockRunner",
      "createMockRunnerByCommand",
      "downloadWorkspace",
      "uploadWorkspace"
    ]);
  });
});
