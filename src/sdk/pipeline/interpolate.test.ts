import { describe, it, expect } from "vitest";
import { interpolate } from "./interpolate.js";
import type { PipelineStepResult } from "./types.js";

describe("interpolate", () => {
  it("replaces step output references", () => {
    const steps: Record<string, PipelineStepResult> = {
      research: { output: "Found 3 bugs", exitCode: 0, duration: 5000 }
    };
    const result = interpolate(
      "Fix these: {{steps.research.output}}",
      steps,
      { name: "test", cwd: "/project" }
    );
    expect(result).toBe("Fix these: Found 3 bugs");
  });

  it("replaces step exitCode references", () => {
    const steps: Record<string, PipelineStepResult> = {
      build: { output: "", exitCode: 1, duration: 3000 }
    };
    const result = interpolate(
      "Build exited with {{steps.build.exitCode}}",
      steps,
      { name: "test", cwd: "/project" }
    );
    expect(result).toBe("Build exited with 1");
  });

  it("replaces pipeline.name", () => {
    const result = interpolate(
      "Running {{pipeline.name}}",
      {},
      { name: "my-pipeline", cwd: "/project" }
    );
    expect(result).toBe("Running my-pipeline");
  });

  it("replaces pipeline.cwd", () => {
    const result = interpolate(
      "Working in {{pipeline.cwd}}",
      {},
      { name: "test", cwd: "/my/project" }
    );
    expect(result).toBe("Working in /my/project");
  });

  it("replaces multiple references in one prompt", () => {
    const steps: Record<string, PipelineStepResult> = {
      a: { output: "output-a", exitCode: 0, duration: 1000 },
      b: { output: "output-b", exitCode: 0, duration: 2000 }
    };
    const result = interpolate(
      "A: {{steps.a.output}}, B: {{steps.b.output}}, Pipeline: {{pipeline.name}}",
      steps,
      { name: "multi", cwd: "/project" }
    );
    expect(result).toBe("A: output-a, B: output-b, Pipeline: multi");
  });

  it("returns prompt unchanged when no references", () => {
    const result = interpolate(
      "Just a prompt with no refs",
      {},
      { name: "test", cwd: "/project" }
    );
    expect(result).toBe("Just a prompt with no refs");
  });

  it("handles multiline output in references", () => {
    const steps: Record<string, PipelineStepResult> = {
      research: {
        output: "Line 1\nLine 2\nLine 3",
        exitCode: 0,
        duration: 5000
      }
    };
    const result = interpolate(
      "Results:\n{{steps.research.output}}",
      steps,
      { name: "test", cwd: "/project" }
    );
    expect(result).toBe("Results:\nLine 1\nLine 2\nLine 3");
  });

  it("handles duplicate references to same step", () => {
    const steps: Record<string, PipelineStepResult> = {
      step1: { output: "hello", exitCode: 0, duration: 1000 }
    };
    const result = interpolate(
      "{{steps.step1.output}} and again {{steps.step1.output}}",
      steps,
      { name: "test", cwd: "/project" }
    );
    expect(result).toBe("hello and again hello");
  });
});
