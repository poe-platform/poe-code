import { describe, expect, it } from "vitest";
import { buildOwnerSystemPrompt, buildSuperintendentSystemPrompt } from "./system-prompt.js";

describe("buildSuperintendentSystemPrompt", () => {
  it("instructs the agent to call workflow.transition with request_review", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt).toContain("workflow.transition");
    expect(prompt).toContain("request_review");
  });

  it("explains that narrative text is not observed by the runtime", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt.toLowerCase()).toContain("narrative");
  });

  it("documents builder.run", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt).toContain("builder.run");
  });

  it("documents inspector.run and lists configured inspectors", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: ["code-quality", "testing"]
    });

    expect(prompt).toContain("inspector.run");
    expect(prompt).toContain("code-quality");
    expect(prompt).toContain("testing");
  });

  it("omits inspector.run when no inspectors are configured", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "in_progress",
      inspectorNames: []
    });

    expect(prompt).not.toContain("inspector.run");
  });

  it("works in review state", () => {
    const prompt = buildSuperintendentSystemPrompt({
      state: "review",
      inspectorNames: ["code-quality"]
    });

    expect(prompt).toContain("workflow.transition");
    expect(prompt).toContain("request_review");
  });
});

describe("buildOwnerSystemPrompt", () => {
  it("documents approve_completion and request_changes", () => {
    const prompt = buildOwnerSystemPrompt();

    expect(prompt).toContain("workflow.transition");
    expect(prompt).toContain("approve_completion");
    expect(prompt).toContain("request_changes");
  });

  it("requires the owner to end with workflow.transition", () => {
    const prompt = buildOwnerSystemPrompt();

    expect(prompt.toLowerCase()).toContain("must");
  });
});
