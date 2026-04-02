import { describe, expect, it } from "vitest";
import type { Runner } from "@poe-code/process-runner";
import * as api from "@poe-code/process-launcher";
import {
  createLogWriter,
  createStateStore,
  createSupervisor,
  listManagedProcesses,
  readManagedLogs,
  removeManagedProcess,
  restartManagedProcess,
  runManagedProcess,
  startManagedProcess,
  stopManagedProcess,
  followManagedLogs,
  waitForReady,
  type LauncherFileSystem,
  type LogWriter,
  type ProcessSpec,
  type ProcessState,
  type ProcessStatus,
  type ReadyCheck,
  type RestartPolicy,
  type StateStore,
  type Supervisor,
  type SupervisorOptions
} from "@poe-code/process-launcher";

describe("@poe-code/process-launcher public exports", () => {
  it("exports SDK helpers and types", () => {
    const restart: RestartPolicy = "always";
    const readyCheck: ReadyCheck = { kind: "tcp", port: 3000, host: "127.0.0.1", timeoutMs: 500 };
    const status: ProcessStatus = "stopped";
    const hostSpec: ProcessSpec = {
      id: "host-service",
      command: "npm",
      args: ["run", "dev"],
      restart: "never"
    };
    const spec: ProcessSpec = {
      id: "service",
      command: "npm",
      args: ["run", "dev"],
      readyCheck,
      restart,
      maxRestarts: 3,
      backoffMs: 250,
      maxBackoffMs: 1_000,
      logRetainCount: 5,
      docker: {
        image: "node:22",
        containerName: "service-test"
      }
    };
    const state: ProcessState = {
      id: spec.id,
      pid: null,
      status,
      runtime: "host",
      restartCount: 0,
      lastExitCode: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      command: spec.command,
      args: spec.args ?? []
    };
    const fs = null as unknown as LauncherFileSystem;
    const supervisor = null as unknown as Supervisor;
    const stateStore = null as unknown as StateStore;
    const logWriter = null as unknown as LogWriter;
    const runner = null as unknown as Runner;
    const signal = new AbortController().signal;
    const options: SupervisorOptions = {
      spec,
      stateDir: "/tmp/poe-code",
      runner,
      signal,
      onLog() {},
      onStatusChange() {}
    };

    expect(typeof createSupervisor).toBe("function");
    expect(typeof createStateStore).toBe("function");
    expect(typeof createLogWriter).toBe("function");
    expect(typeof waitForReady).toBe("function");
    expect(options.spec.readyCheck).toEqual(readyCheck);
    expect(options.runner).toBe(runner);
    expect(hostSpec.docker).toBeUndefined();
    expect(spec.docker?.containerName).toBe("service-test");

    void fs;
    void supervisor;
    void stateStore;
    void logWriter;
    void state;
  });

  it("keeps type-only exports out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("ProcessSpec");
    expect(api).not.toHaveProperty("SupervisorOptions");
    expect(api).not.toHaveProperty("StateStore");
    expect(api.createStateStore).toBe(createStateStore);
    expect(api.createLogWriter).toBe(createLogWriter);
    expect(api.waitForReady).toBe(waitForReady);
    expect(api.createSupervisor).toBe(createSupervisor);
    expect(api.followManagedLogs).toBe(followManagedLogs);
    expect(api.listManagedProcesses).toBe(listManagedProcesses);
    expect(api.readManagedLogs).toBe(readManagedLogs);
    expect(api.removeManagedProcess).toBe(removeManagedProcess);
    expect(api.restartManagedProcess).toBe(restartManagedProcess);
    expect(api.runManagedProcess).toBe(runManagedProcess);
    expect(api.startManagedProcess).toBe(startManagedProcess);
    expect(api.stopManagedProcess).toBe(stopManagedProcess);
    expect(Object.keys(api)).toEqual([
      "createStateStore",
      "createLogWriter",
      "waitForReady",
      "createSupervisor",
      "followManagedLogs",
      "listManagedProcesses",
      "readManagedLogs",
      "removeManagedProcess",
      "restartManagedProcess",
      "runManagedProcess",
      "startManagedProcess",
      "stopManagedProcess"
    ]);
  });
});
