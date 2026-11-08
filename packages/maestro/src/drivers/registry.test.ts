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
    expect(listDrivers()).toEqual(["gh-issue", "pipeline"]);
  });

  it("returns undefined for unknown kinds without throwing", async () => {
    const { getDriver } = await import("./registry.js");

    expect(() => getDriver("missing")).not.toThrow();
    expect(getDriver("missing")).toBeUndefined();
  });

  it("rejects duplicate kinds with a stable error message", async () => {
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
    expect(listDrivers()).toEqual(["pipeline"]);
  });

  it("lists sorted kind names from a copy of the registry", async () => {
    const { getDriver, listDrivers, registerDriver } = await import("./registry.js");
    const pipeline = createDriver("pipeline");
    const ralph = createDriver("ralph");

    registerDriver(pipeline);
    registerDriver(ralph);
    const listed = listDrivers() as string[];
    listed.pop();

    expect(getDriver("pipeline")).toBe(pipeline);
    expect(listDrivers()).toEqual(["pipeline", "ralph"]);
  });

  it("observes registrations on the next getDriver call", async () => {
    const { getDriver, registerDriver } = await import("./registry.js");
    const late = createDriver("late");
    const readDriver = getDriver;

    expect(readDriver("late")).toBeUndefined();

    registerDriver(late);

    expect(readDriver("late")).toBe(late);
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
