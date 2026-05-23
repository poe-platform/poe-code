import { describe, expect, it } from "vitest";

import { resolveDispatch, UnsupportedPlanKindError } from "./dispatch.js";

const baseInput = {
  planBody: "Implement the requested feature.",
  planPath: "/tmp/eval-clone/docs/plans/task.md",
  agent: "codex",
  model: "gpt-5"
};

describe("resolveDispatch", () => {
  it("resolves plan dispatch to the selected agent and prompt", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "plan" })).toEqual({
      kind: "agent",
      agent: "codex",
      prompt: "Implement the requested feature."
    });
  });

  it("resolves pipeline dispatch to its package runner", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "pipeline" })).toEqual({
      kind: "pipeline",
      planPath: "/tmp/eval-clone/docs/plans/task.md",
      agent: "codex",
      model: "gpt-5"
    });
  });

  it("resolves superintendent dispatch to its package runner", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "superintendent" })).toEqual({
      kind: "superintendent",
      planPath: "/tmp/eval-clone/docs/plans/task.md",
      agent: "codex",
      model: "gpt-5"
    });
  });

  it("resolves experiment dispatch to its package runner", () => {
    expect(resolveDispatch({ ...baseInput, planKind: "experiment" })).toEqual({
      kind: "experiment",
      planPath: "/tmp/eval-clone/docs/plans/task.md",
      agent: "codex",
      model: "gpt-5"
    });
  });

  it("throws UnsupportedPlanKindError for unsupported plan kinds", () => {
    expect(() => resolveDispatch({ ...baseInput, planKind: "unknown" as never })).toThrow(
      UnsupportedPlanKindError
    );
  });
});
