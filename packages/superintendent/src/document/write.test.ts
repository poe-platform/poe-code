import { describe, expect, it } from "vitest";
import { parseSuperintendentDoc, type StatusBlock } from "./parse.js";
import { incrementRound, setReviewTurn, transitionState, updateStatus } from "./write.js";

const filePath = "plans/superintendent.md";

const baseContent = `---
kind: superintendent
version: 1
mcp:
  delegate:
    command: poe-superintendent-mcp
builder:
  agent: claude-code
  mode: yolo
  prompt: |
    Build the next task.
superintendent:
  agent: claude-code
  prompt: |
    Review the work.
owner:
  agent: claude-code
  prompt: |
    Approve the result.
max_rounds: 12
status:
  state: review
  round: 3
  review_turn: 2
---
# Task Board

- [ ] Implement the status writer
`;

const baseCrLfContent =
  [
    "\uFEFF---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    "  agent: claude-code",
    "  prompt: |",
    "    Build the next task.",
    "superintendent:",
    "  agent: claude-code",
    "  prompt: review",
    "owner:",
    "  agent: claude-code",
    "  prompt: approve",
    "status:",
    "  state: review",
    "  round: 3",
    "  review_turn: 2",
    "---",
    "# Task Board",
    "",
    "- [ ] Implement the status writer",
    ""
  ].join("\r\n");

describe("superintendent document write helpers", () => {
  it("updateStatus preserves body and other frontmatter", () => {
    const nextStatus: StatusBlock = {
      state: "completed",
      round: 4,
      review_turn: 5
    };

    const original = parseSuperintendentDoc(filePath, baseContent);
    const updatedContent = updateStatus(filePath, baseContent, nextStatus);
    const updated = parseSuperintendentDoc(filePath, updatedContent);

    expect(updated.body).toBe(original.body);
    expect(updated.frontmatter).toEqual({
      ...original.frontmatter,
      status: nextStatus
    });
  });

  it("incrementRound increments correctly", () => {
    const updatedContent = incrementRound(filePath, baseContent);
    const updated = parseSuperintendentDoc(filePath, updatedContent);

    expect(updated.frontmatter.status).toEqual({
      state: "review",
      round: 4,
      review_turn: 2
    });
  });

  it("setReviewTurn updates review_turn", () => {
    const updatedContent = setReviewTurn(filePath, baseContent, 9);
    const updated = parseSuperintendentDoc(filePath, updatedContent);

    expect(updated.frontmatter.status).toEqual({
      state: "review",
      round: 3,
      review_turn: 9
    });
  });

  it("transitionState resets review_turn when going to in_progress", () => {
    const updatedContent = transitionState(filePath, baseContent, "in_progress");
    const updated = parseSuperintendentDoc(filePath, updatedContent);

    expect(updated.frontmatter.status).toEqual({
      state: "in_progress",
      round: 3,
      review_turn: 0
    });
  });

  it("preserves BOM and CRLF line endings", () => {
    const updatedContent = setReviewTurn(filePath, baseCrLfContent, 9);
    const updated = parseSuperintendentDoc(filePath, updatedContent);

    expect(updatedContent.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(updatedContent).toContain("review_turn: 9\r\n---\r\n# Task Board\r\n");
    expect(updated.body).toBe("# Task Board\r\n\r\n- [ ] Implement the status writer\r\n");
    expect(updated.frontmatter.status).toEqual({
      state: "review",
      round: 3,
      review_turn: 9
    });
  });

  it("round-trips with parse", () => {
    const nextStatus: StatusBlock = {
      state: "review",
      round: 8,
      review_turn: 1
    };

    const updatedContent = updateStatus(filePath, baseContent, nextStatus);
    const parsed = parseSuperintendentDoc(filePath, updatedContent);

    expect(parsed.frontmatter.status).toEqual(nextStatus);
  });
});
