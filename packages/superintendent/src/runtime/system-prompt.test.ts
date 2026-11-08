import { describe, expect, it } from "vitest";
import {
  buildInspectorSystemPrompt,
  buildOwnerSystemPrompt,
  buildSuperintendentSystemPrompt
} from "./system-prompt.js";

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

describe("buildInspectorSystemPrompt", () => {
  it("names the inspector and tells it to scope review to the builder change", () => {
    const prompt = buildInspectorSystemPrompt({
      inspectorName: "code-quality",
      builder: { summary: "Added install.ts module" }
    });

    expect(prompt).toContain("`code-quality`");
    expect(prompt).toContain("scope your review");
    expect(prompt).toContain("Added install.ts module");
  });

  it("includes the replay log command when log_path is present", () => {
    const prompt = buildInspectorSystemPrompt({
      inspectorName: "testing",
      builder: {
        summary: "Built thing",
        log_path: "/tmp/spawn-logs/round-7-builder.jsonl"
      }
    });

    expect(prompt).toContain("npm run replay -- /tmp/spawn-logs/round-7-builder.jsonl");
  });

  it("omits the replay section when no log_path is provided", () => {
    const prompt = buildInspectorSystemPrompt({
      inspectorName: "testing",
      builder: { summary: "Built thing" }
    });

    expect(prompt).not.toContain("npm run replay");
  });

  it("falls back to a placeholder when builder summary is empty", () => {
    const prompt = buildInspectorSystemPrompt({
      inspectorName: "code-quality",
      builder: { summary: "" }
    });

    expect(prompt).toContain("(builder produced no summary)");
  });

  it("works without builder context", () => {
    const prompt = buildInspectorSystemPrompt({ inspectorName: "code-quality" });

    expect(prompt).toContain("`code-quality`");
    expect(prompt).not.toContain("Builder summary");
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
