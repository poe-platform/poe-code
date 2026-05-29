import { describe, expect, it } from "vitest";
import {
  normalizeParticipantConfig,
  selectParticipantAgent,
  type WorkflowParticipant
} from "./participant.js";

describe("normalizeParticipantConfig", () => {
  it("normalizes a string agent", () => {
    expect(normalizeParticipantConfig("writer", "claude")).toEqual({
      id: "writer",
      agent: "claude-code"
    });
  });

  it("normalizes an object with a single agent", () => {
    expect(
      normalizeParticipantConfig("reviewer", {
        agent: "codex",
        mode: "read",
        model: "openai/gpt-5.4",
        prompt: "Review the diff"
      })
    ).toEqual({
      id: "reviewer",
      agent: "codex",
      mode: "read",
      model: "openai/gpt-5.4",
      prompt: "Review the diff"
    });
  });

  it("normalizes an object with an agent array", () => {
    expect(
      normalizeParticipantConfig("ensemble", {
        agent: ["claude", "codex"]
      })
    ).toEqual({
      id: "ensemble",
      agent: ["claude-code", "codex"]
    });
  });

  it("preserves inline model syntax while normalizing the agent id", () => {
    expect(
      normalizeParticipantConfig("writer", "claude:anthropic/claude-opus-4.6")
    ).toEqual({
      id: "writer",
      agent: "claude-code:anthropic/claude-opus-4.6"
    });
  });

  it("throws for an empty string agent", () => {
    expect(() => normalizeParticipantConfig("writer", "   ")).toThrow(
      'Participant "writer" must define a non-empty agent.'
    );
  });

  it("throws for an empty agent array", () => {
    expect(() =>
      normalizeParticipantConfig("writer", {
        agent: []
      })
    ).toThrow('Participant "writer" must define at least one agent.');
  });

  it("throws for an invalid agent field type", () => {
    expect(() =>
      normalizeParticipantConfig("writer", {
        agent: true
      })
    ).toThrow(
      'Participant "writer" has invalid agent. Expected a string or string array.'
    );
  });

  it("throws for an invalid agent array entry", () => {
    expect(() =>
      normalizeParticipantConfig("writer", {
        agent: ["claude", 42]
      })
    ).toThrow(
      'Participant "writer" has invalid agent. Expected a string or string array.'
    );
  });

  it("throws when agent is missing", () => {
    expect(() =>
      normalizeParticipantConfig("writer", {
        mode: "edit"
      })
    ).toThrow('Participant "writer" is missing required field: agent.');
  });

  it("throws when the participant config is not a string or object", () => {
    expect(() => normalizeParticipantConfig("writer", 123)).toThrow(
      'Participant "writer" must be a string or object.'
    );
  });
});

describe("selectParticipantAgent", () => {
  it("returns the single agent unchanged", () => {
    const participant: WorkflowParticipant = {
      id: "writer",
      agent: "claude-code"
    };

    expect(selectParticipantAgent(participant, 0)).toBe("claude-code");
    expect(selectParticipantAgent(participant, 99)).toBe("claude-code");
  });

  it("selects agents round-robin across iterations", () => {
    const participant: WorkflowParticipant = {
      id: "ensemble",
      agent: ["claude-code", "codex", "kimi"]
    };

    expect(selectParticipantAgent(participant, 0)).toBe("claude-code");
    expect(selectParticipantAgent(participant, 1)).toBe("codex");
    expect(selectParticipantAgent(participant, 2)).toBe("kimi");
    expect(selectParticipantAgent(participant, 3)).toBe("claude-code");
    expect(selectParticipantAgent(participant, 4)).toBe("codex");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid iteration %s",
    (iteration) => {
      const participant: WorkflowParticipant = {
        id: "ensemble",
        agent: ["claude-code", "codex"]
      };

      expect(() => selectParticipantAgent(participant, iteration)).toThrow(
        "Participant iteration must be a non-negative integer."
      );
    }
  );
});
