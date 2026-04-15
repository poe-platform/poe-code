import { describe, expect, it } from "vitest";
import {
  builderTurn,
  createSuperintendentSimulation,
  ownerApproveTurn,
  successTurn,
  superintendentTurn
} from "./simulation.js";

function createDoc(
  options: { maxRounds?: number; state?: "in_progress" | "review" | "completed" } = {}
): string {
  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    "  agent: claude-code",
    "  prompt: |",
    "    Build {{plan.path}}",
    "superintendent:",
    "  agent: codex",
    "  prompt: |",
    "    Review {{builder.summary}}",
    "owner:",
    "  agent: claude-code",
    "  prompt: |",
    "    Review {{superintendent.summary}}",
    `max_rounds: ${options.maxRounds ?? 1}`,
    "status:",
    `  state: ${options.state ?? "in_progress"}`,
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Plan",
    "",
    "## Task Board",
    "",
    "- [ ] Task 1",
    ""
  ].join("\n");
}

describe("createSuperintendentSimulation", () => {
  it("runs and returns a result when initialized with one success turn", async () => {
    const simulation = createSuperintendentSimulation({
      docContent: createDoc({ state: "completed" }),
      turns: [successTurn()]
    });

    const result = await simulation.run();

    expect(result.result.state).toBe("completed");
    expect(result.prompts).toEqual([]);
    await expect(result.readDoc()).resolves.toMatchObject({
      frontmatter: {
        status: {
          state: "completed",
          round: 0,
          review_turn: 0
        }
      }
    });
  });

  it("captures prompts in order", async () => {
    const simulation = createSuperintendentSimulation({
      docContent: createDoc(),
      turns: [successTurn(), successTurn()]
    });

    const result = await simulation.run();

    expect(result.prompts.map((prompt) => prompt.trimEnd())).toEqual([
      "Build /repo/.poe-code/superintendent/plan.md",
      "Review Builder completed without output."
    ]);
    expect(result.runs).toHaveLength(2);
  });

  it("supports workflow transition helpers across the full lifecycle", async () => {
    const simulation = createSuperintendentSimulation({
      docContent: createDoc({ maxRounds: 2 }),
      turns: [
        successTurn(),
        superintendentTurn({
          action: "request_review",
          summary: "Ready for owner review"
        }),
        ownerApproveTurn()
      ]
    });

    const result = await simulation.run();

    expect(result.result.state).toBe("completed");
    expect(result.prompts.map((prompt) => prompt.trimEnd())).toEqual([
      "Build /repo/.poe-code/superintendent/plan.md",
      "Review Builder completed without output.",
      "Review Ready for owner review"
    ]);
    await expect(result.readDoc()).resolves.toMatchObject({
      frontmatter: {
        status: {
          state: "completed",
          round: 1,
          review_turn: 0
        }
      }
    });
  });

  it("reflects file changes from turns in the final filesystem state", async () => {
    const simulation = createSuperintendentSimulation({
      docContent: createDoc(),
      turns: [builderTurn({ "notes/build.txt": "done" }), successTurn()]
    });

    const result = await simulation.run();

    await expect(result.readFile("notes/build.txt")).resolves.toBe("done");
  });

  it("overrides max_rounds in the seeded simulation document", async () => {
    const simulation = createSuperintendentSimulation({
      docContent: createDoc({ maxRounds: 99 }),
      maxRounds: 1,
      turns: [successTurn(), successTurn()]
    });

    const result = await simulation.run();

    expect(result.result.maxRounds).toBe(1);
    await expect(result.readDoc()).resolves.toMatchObject({
      frontmatter: {
        max_rounds: 1
      }
    });
  });

  it("throws when the loop makes more agent calls than provided turns", async () => {
    const simulation = createSuperintendentSimulation({
      docContent: createDoc(),
      turns: [successTurn()]
    });

    await expect(simulation.run()).rejects.toThrow("Superintendent simulation ran out of turns.");
  });
});
