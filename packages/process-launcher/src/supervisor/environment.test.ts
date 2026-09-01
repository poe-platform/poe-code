import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostRunner, type RunSpec, type Runner } from "@poe-code/process-runner";
import { createMockRunner } from "@poe-code/process-runner/testing";
import type { LauncherFileSystem } from "../types.js";
import { createSupervisor } from "./supervisor.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supervisor host environment overrides", () => {
  it.each(["default", "injected"])("inherits parent values with %s host runner overrides", async mode => {
    vi.stubEnv("POE_LAUNCHER_PARENT", "inherited");
    const result = await collectEnvironment(
      { POE_LAUNCHER_EXTRA: "explicit" },
      mode === "injected" ? createHostRunner() : undefined
    );

    expect(result).toEqual({ parent: "inherited", extra: "explicit" });
  });

  it.each([undefined, {}])("inherits parent values with no effective overrides: %j", async env => {
    vi.stubEnv("POE_LAUNCHER_PARENT", "inherited");
    vi.stubEnv("POE_LAUNCHER_EXTRA", undefined);

    expect(await collectEnvironment(env)).toEqual({ parent: "inherited", extra: null });
  });

  it.each(["replacement", ""])("gives an explicit value precedence, including %j", async value => {
    vi.stubEnv("POE_LAUNCHER_PARENT", "inherited");
    vi.stubEnv("POE_LAUNCHER_EXTRA", undefined);

    expect(await collectEnvironment({ POE_LAUNCHER_PARENT: value })).toEqual({ parent: value, extra: null });
    expect(process.env.POE_LAUNCHER_PARENT).toBe("inherited");
  });

  it("does not mutate the caller's overrides or the parent's environment", async () => {
    vi.stubEnv("POE_LAUNCHER_PARENT", "inherited");
    vi.stubEnv("POE_LAUNCHER_EXTRA", undefined);
    const env = Object.freeze({ POE_LAUNCHER_EXTRA: "explicit" });

    expect(await collectEnvironment(env)).toEqual({ parent: "inherited", extra: "explicit" });
    expect(env).toEqual({ POE_LAUNCHER_EXTRA: "explicit" });
    expect(process.env.POE_LAUNCHER_EXTRA).toBeUndefined();
  });

  it("takes a fresh parent snapshot when restarting", async () => {
    vi.stubEnv("POE_LAUNCHER_PARENT", "first");
    const runs: RunSpec[] = [];
    const baseRunner = createMockRunner([
      { exitCode: 0, exitAfterMs: 10_000 },
      { exitCode: 0, exitAfterMs: 10_000 }
    ]);
    const runner: Runner = {
      name: "host",
      exec(spec) {
        runs.push(spec);
        return baseRunner.exec(spec);
      }
    };
    const supervisor = createSupervisor({
      fs: createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem,
      runner,
      spec: { id: "env-restart", command: "unused", env: { POE_LAUNCHER_EXTRA: "explicit" }, restart: "never" },
      stateDir: "/state",
      startSettleMs: 0
    });

    try {
      await supervisor.start();
      vi.stubEnv("POE_LAUNCHER_PARENT", "second");
      await supervisor.restart();

      expect(runs.map(run => run.env?.POE_LAUNCHER_PARENT)).toEqual(["first", "second"]);
      expect(runs.map(run => run.env?.POE_LAUNCHER_EXTRA)).toEqual(["explicit", "explicit"]);
      expect(runs[0].env).not.toBe(runs[1].env);
    } finally {
      await supervisor.stop();
    }
  });

  it.each(["docker", "custom"])("preserves the %s runner's own environment contract", async name => {
    vi.stubEnv("POE_LAUNCHER_PARENT", "inherited");
    const env = { POE_LAUNCHER_EXTRA: "explicit" };
    const baseRunner = createMockRunner([{ exitCode: 0, exitAfterMs: 10_000 }]);
    const exec = vi.fn(baseRunner.exec);
    const supervisor = createSupervisor({
      fs: createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem,
      runner: { name, exec },
      spec: { id: "env-runtime", command: "unused", env, restart: "never" },
      stateDir: "/state",
      startSettleMs: 0
    });

    try {
      await supervisor.start();

      expect(exec.mock.calls[0][0].env).toBe(env);
      expect(exec.mock.calls[0][0].env?.POE_LAUNCHER_PARENT).toBeUndefined();
    } finally {
      await supervisor.stop();
    }
  });
});

async function collectEnvironment(env?: Record<string, string>, runner?: Runner): Promise<unknown> {
  const lines: string[] = [];
  const errors: unknown[] = [];
  const supervisor = createSupervisor({
    fs: createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem,
    runner,
    spec: {
      id: "env-child",
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({parent: process.env.POE_LAUNCHER_PARENT ?? null, extra: process.env.POE_LAUNCHER_EXTRA ?? null}))"],
      env,
      restart: "never"
    },
    stateDir: "/state",
    startSettleMs: 0,
    onLog: line => lines.push(line),
    onError: error => errors.push(error)
  });

  try {
    await supervisor.start();
    await vi.waitFor(() => expect(supervisor.getState().lastExitCode).toBe(0), { interval: 10 });
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0]);
  } finally {
    await supervisor.stop();
  }
}
