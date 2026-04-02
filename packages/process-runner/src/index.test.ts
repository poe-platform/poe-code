import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { buildContextArgs, detectContext } from "./docker/context.js";
import { detectEngine, isEngineAvailable } from "./docker/engine.js";
import { createDockerRunner } from "./docker/docker-runner.js";
import { createHostRunner } from "./host/host-runner.js";
import { createMockRunner, createMockRunnerByCommand } from "./testing/index.js";
import type {
  DockerMount,
  DockerPortMapping,
  DockerRunArgs,
  DockerRunnerOptions,
  Engine,
  HostRunnerOptions,
  MockRunBehavior,
  RunHandle,
  Runner,
  RunSpec
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
      signal: new AbortController().signal
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
    const runner: Runner = {
      name: "host",
      exec() {
        return handle;
      }
    };

    expect(runner.exec(spec)).toBe(handle);
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
    expect(api.detectEngine).toBe(detectEngine);
    expect(api.isEngineAvailable).toBe(isEngineAvailable);
    expect(api.createHostRunner).toBe(createHostRunner);
    expect(api.createDockerRunner).toBe(createDockerRunner);
    expect(api.createMockRunner).toBe(createMockRunner);
    expect(api.createMockRunnerByCommand).toBe(createMockRunnerByCommand);
    expect(Object.keys(api)).toEqual([
      "buildContextArgs",
      "detectContext",
      "detectEngine",
      "isEngineAvailable",
      "createDockerRunner",
      "createHostRunner",
      "createMockRunner",
      "createMockRunnerByCommand"
    ]);
  });
});
