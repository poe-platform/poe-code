import { describe, expect, it } from "vitest";
import { MEMORY_AGENT_JSON_CONTRACT, parseMemoryAgentResponse } from "./agent-response.js";

describe("parseMemoryAgentResponse", () => {
  it("parses a well-formed agent payload", () => {
    expect(
      parseMemoryAgentResponse(
        JSON.stringify({
          answer: "Retries happen during cleanup races.",
          citations: [{ relPath: "pages/note.md", confidence: "inferred" }],
          tokensUsed: 12
        })
      )
    ).toEqual({
      answer: "Retries happen during cleanup races.",
      citations: [{ relPath: "pages/note.md", confidence: "inferred" }],
      tokensUsed: 12
    });
  });

  it("reports the prose the agent actually printed instead of an opaque one-liner", () => {
    expect(() => parseMemoryAgentResponse("I cannot help with that request.")).toThrow(
      'Received stdout: "I cannot help with that request."'
    );
  });

  it("reports agent stderr when stdout carries no usable output", () => {
    expect(() => parseMemoryAgentResponse("  ", { stderr: "model sonnet-5 is unavailable\n" })).toThrow(
      'Received stdout: <empty> stderr: "model sonnet-5 is unavailable"'
    );
  });

  it("truncates overlong agent output so the message stays readable", () => {
    const message = captureMessage(() => parseMemoryAgentResponse("x".repeat(1000)));

    expect(message).toContain("…");
    expect(message.length).toBeLessThan(500);
  });

  it("reports what a structurally invalid payload contained", () => {
    expect(() => parseMemoryAgentResponse(JSON.stringify({ answer: 1 }))).toThrow(
      'Memory agent returned an invalid result payload. Received stdout: "{\\"answer\\":1}"'
    );
  });

  it("states the contract the parser enforces", () => {
    expect(MEMORY_AGENT_JSON_CONTRACT).toContain("answer");
    expect(MEMORY_AGENT_JSON_CONTRACT).toContain("citations");
    expect(MEMORY_AGENT_JSON_CONTRACT).toContain("relPath");
    expect(MEMORY_AGENT_JSON_CONTRACT).toContain("tokensUsed");
    expect(MEMORY_AGENT_JSON_CONTRACT).toContain("extracted");
  });
});

function captureMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the call to throw.");
}
