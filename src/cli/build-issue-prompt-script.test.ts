import { describe, expect, it } from "vitest";

const scriptUrl = new URL(
  "../../scripts/workflows/build-issue-prompt.cjs",
  import.meta.url
).href;

describe("build issue prompt workflow script", () => {
  it("adds explicit model-discovery guidance for renamed models", async () => {
    const { buildPrompt } = await import(scriptUrl);

    const prompt = buildPrompt({
      issueNumber: 123,
      issue: {
        title: "Renamed model: old-name -> new-name",
        body: "## Event\n\n- type: renamed\n",
        user: { login: "poe-bot" },
        created_at: "2026-03-18T10:00:00.000Z"
      },
      comments: []
    });

    expect(prompt).toContain(
      "This is a model discovery issue triggered by a Poe model changelog event."
    );
    expect(prompt).toContain(
      "The Poe model `old-name` was renamed to `new-name`."
    );
    expect(prompt).toContain(
      "Determine whether any model mentions in this repository need updating because of this rename, and make the update if needed."
    );
    expect(prompt).toContain(
      "If updates are needed, implement the minimal required changes and commit them."
    );
  });

  it("falls back to the generic issue prompt for non-model issues", async () => {
    const { buildPrompt } = await import(scriptUrl);

    const prompt = buildPrompt({
      issueNumber: 456,
      issue: {
        title: "Fix flaky test",
        body: "Investigate the intermittent failure.",
        user: { login: "poe-bot" },
        created_at: "2026-03-18T11:00:00.000Z"
      },
      comments: []
    });

    expect(prompt).not.toContain(
      "This is a model discovery issue triggered by a Poe model changelog event."
    );
    expect(prompt).toContain("Implement the required changes and commit them.");
  });

  it("tells the agent to make the update for added models when warranted", async () => {
    const { buildPrompt } = await import(scriptUrl);

    const prompt = buildPrompt({
      issueNumber: 789,
      issue: {
        title: "New model: gpt-5.3-codex",
        body: "## Event\n\n- type: added\n",
        user: { login: "poe-bot" },
        created_at: "2026-03-18T12:00:00.000Z"
      },
      comments: []
    });

    expect(prompt).toContain(
      "Determine whether any existing model mentions in this repository need updating because of this addition, and make the update if needed."
    );
  });
});
