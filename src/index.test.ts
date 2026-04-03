import { describe, it, expect } from "vitest";
import {
  createLogWriter,
  createStateStore,
  createSupervisor,
  ghGroup,
  getPoeApiKey,
  isCliInvocation,
  runExperiment,
  runRalph,
  waitForReady,
  type AutomationDefinition,
  type ProcessSpec,
  type SupervisorOptions
} from "./index.js";

describe("entrypoint module", () => {
  it("re-exports getPoeApiKey", async () => {
    const previous = process.env.POE_API_KEY;
    process.env.POE_API_KEY = "sdk-test-key";

    try {
      await expect(getPoeApiKey()).resolves.toBe("sdk-test-key");
    } finally {
      if (typeof previous === "string") {
        process.env.POE_API_KEY = previous;
      } else {
        delete process.env.POE_API_KEY;
      }
    }
  });

  it("detects direct invocation path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/index.js"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(true);
  });

  it("detects invocation through symlinked path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/usr/bin/poe-code"];
    const resolver = (value: string) =>
      value === "/usr/bin/poe-code" ? "/app/dist/index.js" : value;
    expect(isCliInvocation(argv, moduleUrl, resolver)).toBe(true);
  });

  it("re-exports runRalph", () => {
    expect(typeof runRalph).toBe("function");
  });

  it("re-exports runExperiment", () => {
    expect(typeof runExperiment).toBe("function");
  });

  it("re-exports process launcher SDK helpers", () => {
    const spec: ProcessSpec = {
      id: "service",
      command: "npm",
      args: ["run", "dev"],
      restart: "on-failure",
      readyCheck: {
        kind: "log-pattern",
        pattern: "ready"
      }
    };
    const options: SupervisorOptions = {
      spec,
      stateDir: "/tmp/poe-code",
      signal: new AbortController().signal,
      onLog() {},
      onStatusChange() {}
    };

    expect(typeof createSupervisor).toBe("function");
    expect(typeof createStateStore).toBe("function");
    expect(typeof createLogWriter).toBe("function");
    expect(typeof waitForReady).toBe("function");
    expect(options.spec.readyCheck).toEqual(spec.readyCheck);
  });

  it("re-exports github workflows SDK symbols", () => {
    const automation: AutomationDefinition = {
      name: "github-issue-opened",
      prompt: "Handle issue"
    };

    expect(ghGroup.name).toBe("github-workflows");
    expect(automation.name).toBe("github-issue-opened");
  });

  it("returns false when invoked via CJS wrapper (bin.cjs)", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/bin.cjs"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(false);
  });
});
