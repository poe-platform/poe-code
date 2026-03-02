import { describe, it, expect } from "vitest";
import { validatePipeline } from "./validate.js";
import type { PipelineDefinition } from "./types.js";

function minimal(overrides: Partial<PipelineDefinition> = {}): PipelineDefinition {
  return {
    name: "test",
    steps: [
      { name: "step1", agent: "claude-code", prompt: "Do it" }
    ],
    ...overrides
  };
}

describe("validatePipeline", () => {
  it("passes for a valid minimal pipeline", () => {
    expect(() => validatePipeline(minimal())).not.toThrow();
  });

  it("resolves agent from defaults when step has no agent", () => {
    const pipeline = minimal({
      defaults: { agent: "claude-code" },
      steps: [{ name: "step1", prompt: "Do it" }]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("throws when step has no agent and no default", () => {
    const pipeline = minimal({
      steps: [{ name: "step1", prompt: "Do it" }]
    });
    expect(() => validatePipeline(pipeline)).toThrow(
      'Step "step1" has no agent'
    );
  });

  it("validates sequential step references to earlier steps", () => {
    const pipeline = minimal({
      steps: [
        { name: "step1", agent: "claude-code", prompt: "First" },
        {
          name: "step2",
          agent: "claude-code",
          prompt: "Based on: {{steps.step1.output}}"
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("rejects forward reference in sequential steps", () => {
    const pipeline = minimal({
      steps: [
        {
          name: "step1",
          agent: "claude-code",
          prompt: "Based on: {{steps.step2.output}}"
        },
        { name: "step2", agent: "claude-code", prompt: "Second" }
      ]
    });
    expect(() => validatePipeline(pipeline)).toThrow(
      'Step "step1" references "step2" which has not completed before it'
    );
  });

  it("allows parallel steps to reference earlier sequential steps", () => {
    const pipeline = minimal({
      steps: [
        { name: "research", agent: "claude-code", prompt: "Analyze" },
        {
          parallel: [
            {
              name: "fix-a",
              agent: "codex",
              prompt: "Fix A: {{steps.research.output}}"
            },
            {
              name: "fix-b",
              agent: "claude-code",
              prompt: "Fix B: {{steps.research.output}}"
            }
          ]
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("rejects parallel sibling references", () => {
    const pipeline = minimal({
      steps: [
        {
          parallel: [
            { name: "fix-a", agent: "codex", prompt: "Fix A" },
            {
              name: "fix-b",
              agent: "claude-code",
              prompt: "Based on: {{steps.fix-a.output}}"
            }
          ]
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).toThrow(
      'Step "fix-b" references "fix-a" which has not completed before it'
    );
  });

  it("allows step after parallel group to reference parallel steps", () => {
    const pipeline = minimal({
      steps: [
        {
          parallel: [
            { name: "a", agent: "codex", prompt: "A" },
            { name: "b", agent: "claude-code", prompt: "B" }
          ]
        },
        {
          name: "final",
          agent: "claude-code",
          prompt: "A: {{steps.a.output}}, B: {{steps.b.output}}"
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("warns on unknown step references", () => {
    const pipeline = minimal({
      steps: [
        {
          name: "step1",
          agent: "claude-code",
          prompt: "Ref: {{steps.nonexistent.output}}"
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).toThrow(
      'Step "step1" references unknown step "nonexistent"'
    );
  });

  it("validates exitCode references", () => {
    const pipeline = minimal({
      steps: [
        { name: "step1", agent: "claude-code", prompt: "First" },
        {
          name: "step2",
          agent: "claude-code",
          prompt: "Code: {{steps.step1.exitCode}}"
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("validates pipeline variable references", () => {
    const pipeline = minimal({
      steps: [
        {
          name: "step1",
          agent: "claude-code",
          prompt: "Pipeline: {{pipeline.name}} in {{pipeline.cwd}}"
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("validates agent in parallel group steps with defaults", () => {
    const pipeline = minimal({
      defaults: { agent: "claude-code" },
      steps: [
        {
          parallel: [
            { name: "a", prompt: "A" },
            { name: "b", prompt: "B" }
          ]
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).not.toThrow();
  });

  it("throws when parallel step has no agent and no default", () => {
    const pipeline = minimal({
      steps: [
        {
          parallel: [
            { name: "a", agent: "codex", prompt: "A" },
            { name: "b", prompt: "B" }
          ]
        }
      ]
    });
    expect(() => validatePipeline(pipeline)).toThrow(
      'Step "b" has no agent'
    );
  });
});
