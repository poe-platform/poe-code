import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDriver } from "./types.js";

describe("workflow driver registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers, gets, and lists drivers", async () => {
    const { getDriver, listDrivers, registerDriver } = await import("./registry.js");
    const pipeline = createDriver("pipeline");
    const issue = createDriver("gh-issue");

    registerDriver(pipeline);
    registerDriver(issue);

    expect(getDriver("pipeline")).toBe(pipeline);
    expect(getDriver("gh-issue")).toBe(issue);
    expect(getDriver("missing")).toBeUndefined();
    expect(listDrivers()).toEqual([pipeline, issue]);
  });

  it("throws when a different driver uses an existing kind", async () => {
    const { registerDriver } = await import("./registry.js");

    registerDriver(createDriver("pipeline"));

    expect(() => registerDriver(createDriver("pipeline"))).toThrow(
      'Workflow driver kind already registered: "pipeline"'
    );
  });

  it("is idempotent for the same driver instance", async () => {
    const { getDriver, listDrivers, registerDriver } = await import("./registry.js");
    const pipeline = createDriver("pipeline");

    registerDriver(pipeline);
    registerDriver(pipeline);

    expect(getDriver("pipeline")).toBe(pipeline);
    expect(listDrivers()).toEqual([pipeline]);
  });
});

function createDriver(kind: string): WorkflowDriver {
  return {
    kind,
    async run() {
      return { reason: "normal" };
    }
  };
}
