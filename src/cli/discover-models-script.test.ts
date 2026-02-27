import { describe, it, expect } from "vitest";

const scriptUrl = new URL(
  "../../scripts/workflows/discover-models.mjs",
  import.meta.url
).href;

describe("discover models workflow script", () => {
  it("collects normalized model events from this week only", async () => {
    const { collectEvents } = await import(scriptUrl);
    const events = collectEvents(
      [
        {
          date: "2026-02-20T23:59:00+00:00",
          added: ["Old-Model"],
          removed: ["Old-Removed"]
        },
        {
          date: "2026-02-23T00:00:00+00:00",
          added: ["GPT-5.2-Codex", "gpt-5.2-codex", "Claude-Opus-4.6"],
          removed: ["Legacy-Model"]
        },
        {
          date: "2026-02-27T10:00:00+00:00",
          added: ["New-One"],
          removed: ["legacy-model"]
        }
      ],
      [
        {
          date: "2026-02-21T10:00:00+00:00",
          renamed: [{ from: "Old-Rename", to: "New-Rename" }]
        },
        {
          date: "2026-02-27T11:00:00+00:00",
          renamed: [
            { from: "Old-Name", to: "New-Name" },
            { from: "old-name", to: "new-name" }
          ]
        }
      ],
      { referenceDate: new Date("2026-02-27T12:00:00+00:00") }
    );

    expect(events.added).toEqual(["gpt-5.2-codex", "claude-opus-4.6", "new-one"]);
    expect(events.removed).toEqual(["legacy-model"]);
    expect(events.renamed).toEqual([{ from: "old-name", to: "new-name" }]);
  });

  it("parses known tracking issue titles into event keys", async () => {
    const { parseIssueKeyFromTitle } = await import(scriptUrl);

    expect(parseIssueKeyFromTitle("New model: GPT-5.2-Codex")).toBe(
      "added::gpt-5.2-codex"
    );
    expect(parseIssueKeyFromTitle("Removed model: legacy-model")).toBe(
      "removed::legacy-model"
    );
    expect(parseIssueKeyFromTitle("Renamed model: old-name -> new-name")).toBe(
      "renamed::old-name->new-name"
    );
    expect(parseIssueKeyFromTitle("Something else")).toBeNull();
  });

  it("builds issue labels with the model label for all created issues", async () => {
    const { buildIssueLabels } = await import(scriptUrl);

    expect(buildIssueLabels("new-model", true)).toEqual([
      "new-model",
      "model",
      "agent:claude-code"
    ]);
    expect(buildIssueLabels("renamed-model", false)).toEqual([
      "renamed-model",
      "model"
    ]);
  });

  it("decides actionability based on event type evidence", async () => {
    const { shouldOpenIssue } = await import(scriptUrl);

    expect(
      shouldOpenIssue("added", {
        exactMentions: [],
        predecessorMentions: []
      })
    ).toBe(false);
    expect(
      shouldOpenIssue("added", {
        exactMentions: ["src/a.ts:1"],
        predecessorMentions: []
      })
    ).toBe(true);

    expect(
      shouldOpenIssue("removed", {
        exactMentions: [],
        predecessorMentions: ["src/b.ts:2"]
      })
    ).toBe(false);
    expect(
      shouldOpenIssue("removed", {
        exactMentions: ["src/b.ts:2"],
        predecessorMentions: []
      })
    ).toBe(true);

    expect(
      shouldOpenIssue("renamed", {
        exactMentions: [],
        predecessorMentions: ["src/c.ts:3"]
      })
    ).toBe(true);
  });
});
