import { describe, expect, it } from "vitest";

import { resolveDispatch, UnsupportedPlanKindError } from "./dispatch.js";

const baseInput = {
  planBody: "Implement the requested feature.",
  planPath: "/tmp/eval-clone/docs/plans/task.md",
  agent: "codex",
  model: "gpt-5",
  poeCodeCliPath: "/repo/packages/poe-code/dist/cli.js"
};

describe("resolveDispatch", () => {
  it("resolves plan dispatch to the selected agent and prompt", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "plan" })).toEqual({
      kind: "agent",
      agent: "codex",
      prompt: "Implement the requested feature.",
      args: []
    });
  });

  it("resolves pipeline dispatch to the poe-code CLI pipeline runner", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "pipeline" })).toEqual({
      kind: "node",
      script: "/repo/packages/poe-code/dist/cli.js",
      args: [
        "pipeline",
        "run",
        "--plan",
        "/tmp/eval-clone/docs/plans/task.md",
        "--agent",
        "codex",
        "--model",
        "gpt-5"
      ]
    });
  });

  it("resolves superintendent dispatch to the poe-code CLI superintendent runner", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "superintendent" })).toEqual({
      kind: "node",
      script: "/repo/packages/poe-code/dist/cli.js",
      args: [
        "superintendent",
        "run",
        "/tmp/eval-clone/docs/plans/task.md",
        "--agent",
        "codex",
        "--model",
        "gpt-5"
      ]
    });
  });

  it("resolves experiment dispatch to the poe-code CLI experiment runner", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "experiment" })).toEqual({
      kind: "node",
      script: "/repo/packages/poe-code/dist/cli.js",
      args: [
        "experiment",
        "run",
        "--doc",
        "/tmp/eval-clone/docs/plans/task.md",
        "--agent",
        "codex",
        "--model",
        "gpt-5"
      ]
    });
  });

  it("throws UnsupportedPlanKindError for unsupported plan kinds", () => {
    expect(() =>
      resolveDispatch({ ...baseInput, planKind: "unknown" as never })
    ).toThrow(UnsupportedPlanKindError);
  });
});
