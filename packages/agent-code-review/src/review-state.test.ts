import { describe, expect, it } from "vitest";
import { parseCodeReviewState, serializeCodeReviewState } from "./review-state.js";

const stateYaml = [
  "version: 1",
  "session_id: session-1",
  "pr_url: https://github.com/acme/widgets/pull/123",
  "pr_ref:",
  "  host: github.com",
  "  owner: acme",
  "  repo: widgets",
  "  number: 123",
  "selected_agent: codex",
  "selected_profiles:",
  "  - __proto__",
  "state: in_progress",
  "timestamps:",
  "  created_at: 2026-05-26T00:00:00.000Z",
  "  updated_at: 2026-05-26T00:00:00.000Z",
  "raw_reviews:",
  "  __proto__:",
  "    body: Prototype-named actor review.",
  "    comments: []",
  "subagents:",
  "  __proto__:",
  "    profile: __proto__",
  "    status: completed",
  "orchestrator_actions: []",
  ""
].join("\n");

describe("parseCodeReviewState", () => {
  it("preserves prototype-named raw reviews and subagents as own entries", () => {
    const state = parseCodeReviewState(stateYaml);

    expect(Object.hasOwn(state.rawReviews, "__proto__")).toBe(true);
    expect(state.rawReviews["__proto__"]).toEqual({
      body: "Prototype-named actor review.",
      comments: []
    });
    expect(Object.getPrototypeOf(state.rawReviews)).toBe(Object.prototype);
    expect(Object.hasOwn(state.subagents, "__proto__")).toBe(true);
    expect(state.subagents["__proto__"]).toEqual({
      profile: "__proto__",
      status: "completed"
    });
    expect(Object.getPrototypeOf(state.subagents)).toBe(Object.prototype);
  });
});

describe("serializeCodeReviewState", () => {
  it("round-trips prototype-named state maps without dropping entries", () => {
    const parsed = parseCodeReviewState(stateYaml);
    const serialized = serializeCodeReviewState(parsed);
    const roundTripped = parseCodeReviewState(serialized);

    expect(Object.hasOwn(roundTripped.rawReviews, "__proto__")).toBe(true);
    expect(roundTripped.rawReviews["__proto__"]).toEqual(parsed.rawReviews["__proto__"]);
    expect(Object.hasOwn(roundTripped.subagents, "__proto__")).toBe(true);
    expect(roundTripped.subagents["__proto__"]).toEqual(parsed.subagents["__proto__"]);
  });
});
