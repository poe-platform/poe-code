import { describe, expect, it } from "vitest";
import { buildOwnerSystemPrompt, buildSuperintendentSystemPrompt } from "./system-prompt.js";

describe("buildSuperintendentSystemPrompt", () => {
  it("instructs the agent to call workflow_transition with request_review", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt).toContain("workflow_transition");
    expect(prompt).toContain("request_review");
  });

  it("explains that narrative text is not observed by the runtime", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt.toLowerCase()).toContain("narrative");
  });

  it("documents builder_run", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt).toContain("builder_run");
  });

  it("documents inspector_run and lists configured inspectors", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: ["code-quality", "testing"]
    });

    expect(prompt).toContain("inspector_run");
    expect(prompt).toContain("code-quality");
    expect(prompt).toContain("testing");
  });

  it("omits inspector_run when no inspectors are configured", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt).not.toContain("inspector_run");
  });

  it("works in review state", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "review",
      inspectorNames: ["code-quality"]
    });

    expect(prompt).toContain("workflow_transition");
    expect(prompt).toContain("request_review");
  });
});

describe("buildOwnerSystemPrompt", () => {
  it("documents approve_completion and request_changes", () => {
    const prompt = buildOwnerSystemPrompt();

    expect(prompt).toContain("workflow_transition");
    expect(prompt).toContain("approve_completion");
    expect(prompt).toContain("request_changes");
  });

  it("requires the owner to end with workflow_transition", () => {
    const prompt = buildOwnerSystemPrompt();

    expect(prompt.toLowerCase()).toContain("must");
  });
});
