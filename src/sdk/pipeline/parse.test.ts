import { describe, it, expect } from "vitest";
import { parsePipeline } from "./parse.js";

describe("parsePipeline", () => {
  it("parses a minimal pipeline", () => {
    const yaml = `
name: quick-review
steps:
  - name: review
    agent: claude-code
    prompt: Review this code
`;
    const result = parsePipeline(yaml);
    expect(result).toEqual({
      name: "quick-review",
      steps: [
        { name: "review", agent: "claude-code", prompt: "Review this code" }
      ]
    });
  });

  it("parses a pipeline with defaults", () => {
    const yaml = `
name: test-pipeline
description: A test pipeline
defaults:
  agent: claude-code
  mode: read
  model: sonnet
steps:
  - name: step1
    prompt: Do something
`;
    const result = parsePipeline(yaml);
    expect(result).toEqual({
      name: "test-pipeline",
      description: "A test pipeline",
      defaults: { agent: "claude-code", mode: "read", model: "sonnet" },
      steps: [{ name: "step1", prompt: "Do something" }]
    });
  });

  it("parses parallel groups", () => {
    const yaml = `
name: parallel-test
steps:
  - name: first
    agent: claude-code
    prompt: First step
  - parallel:
      - name: a
        agent: codex
        prompt: Step A
      - name: b
        agent: claude-code
        prompt: Step B
  - name: last
    agent: claude-code
    prompt: Last step
`;
    const result = parsePipeline(yaml);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1]).toEqual({
      parallel: [
        { name: "a", agent: "codex", prompt: "Step A" },
        { name: "b", agent: "claude-code", prompt: "Step B" }
      ]
    });
  });

  it("parses steps with all optional fields", () => {
    const yaml = `
name: full
steps:
  - name: step1
    agent: codex
    prompt: Do it
    mode: edit
    model: o3-pro
    args:
      - --flag
      - value
    cwd: /tmp/project
`;
    const result = parsePipeline(yaml);
    expect(result.steps[0]).toEqual({
      name: "step1",
      agent: "codex",
      prompt: "Do it",
      mode: "edit",
      model: "o3-pro",
      args: ["--flag", "value"],
      cwd: "/tmp/project"
    });
  });

  it("throws on missing name", () => {
    const yaml = `
steps:
  - name: step1
    agent: claude-code
    prompt: Do it
`;
    expect(() => parsePipeline(yaml)).toThrow("name");
  });

  it("throws on missing steps", () => {
    const yaml = `
name: no-steps
`;
    expect(() => parsePipeline(yaml)).toThrow("steps");
  });

  it("throws on empty steps", () => {
    const yaml = `
name: empty
steps: []
`;
    expect(() => parsePipeline(yaml)).toThrow("steps");
  });

  it("throws on step missing name", () => {
    const yaml = `
name: test
steps:
  - agent: claude-code
    prompt: Do it
`;
    expect(() => parsePipeline(yaml)).toThrow("name");
  });

  it("throws on step missing prompt", () => {
    const yaml = `
name: test
steps:
  - name: step1
    agent: claude-code
`;
    expect(() => parsePipeline(yaml)).toThrow("prompt");
  });

  it("throws on duplicate step names", () => {
    const yaml = `
name: test
steps:
  - name: step1
    agent: claude-code
    prompt: First
  - name: step1
    agent: claude-code
    prompt: Second
`;
    expect(() => parsePipeline(yaml)).toThrow('Duplicate step name "step1"');
  });

  it("throws on duplicate names across parallel groups", () => {
    const yaml = `
name: test
steps:
  - name: step1
    agent: claude-code
    prompt: First
  - parallel:
      - name: step1
        agent: codex
        prompt: Second
      - name: step2
        agent: claude-code
        prompt: Third
`;
    expect(() => parsePipeline(yaml)).toThrow('Duplicate step name "step1"');
  });

  it("throws on parallel group with fewer than 2 steps", () => {
    const yaml = `
name: test
steps:
  - parallel:
      - name: only
        agent: claude-code
        prompt: Alone
`;
    expect(() => parsePipeline(yaml)).toThrow("at least 2 steps");
  });

  it("throws on invalid YAML", () => {
    expect(() => parsePipeline(":::invalid")).toThrow();
  });

  it("throws on invalid mode value", () => {
    const yaml = `
name: test
steps:
  - name: step1
    agent: claude-code
    prompt: Do it
    mode: invalid
`;
    expect(() => parsePipeline(yaml)).toThrow("mode");
  });

  it("throws on invalid defaults mode", () => {
    const yaml = `
name: test
defaults:
  mode: invalid
steps:
  - name: step1
    agent: claude-code
    prompt: Do it
`;
    expect(() => parsePipeline(yaml)).toThrow("mode");
  });
});
