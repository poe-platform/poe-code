import { describe, expect, it } from "vitest";
import { parseTaskBoard } from "./document/tasks.js";
import { createSuperintendentSimulation } from "./testing/simulation.js";

const docPath = ".poe-code/superintendent/plans/happy-path.md";
const absoluteDocPath = "/repo/.poe-code/superintendent/plans/happy-path.md";

function createDoc(options: { tasksChecked?: boolean } = {}): string {
  const checkbox = options.tasksChecked ? "x" : " ";

  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    "  agent: claude-code",
    "  mode: yolo",
    "  prompt: |",
    "    Builder handles {{plan.path}}",
    "inspectors:",
    "  code-quality:",
    "    agent: codex",
    "    prompt: |",
    "      Inspect {{plan.path}} after {{builder.summary}}",
    "superintendent:",
    "  agent: codex",
    "  prompt: |",
    "    Superintendent review builder={{builder.summary}} inspector={{inspectors.code-quality}}",
    "owner:",
    "  agent: claude-code",
    "  prompt: |",
    "    Owner review {{superintendent.summary}}",
    "status:",
    "  state: in_progress",
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Plan",
    "",
    "## Task Board",
    "",
    `- [${checkbox}] Task 1`,
    `- [${checkbox}] Task 2`,
    ""
  ].join("\n");
}

describe("createSuperintendentSimulation", () => {
  it("completes the happy path in one round when the owner approves", async () => {
    const builderSummary = "Checked off Task 1 and Task 2";
    const inspectorSummary = "All checks pass";
    const superintendentSummary = "Ready for owner review";

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc(),
      turns: [
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).not.toContain("{{plan.path}}");

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 2,
              doneCount: 0,
              allDone: false
            });
          },
          fileChanges: {
            [docPath]: createDoc({ tasksChecked: true })
          },
          output: {
            stdout: builderSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).toContain(builderSummary);
            expect(prompt).not.toContain("{{plan.path}}");

            const doc = await ctx.readDoc();
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 0,
              doneCount: 2,
              allDone: true
            });
          },
          output: {
            stdout: inspectorSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(builderSummary);
            expect(prompt).toContain(inspectorSummary);
            expect(prompt).not.toContain("{{builder.summary}}");
            expect(prompt).not.toContain("{{inspectors.code-quality}}");

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow.transition(" +
              JSON.stringify({
                action: "request_review",
                summary: superintendentSummary
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(superintendentSummary);
            expect(prompt).not.toContain("{{superintendent.summary}}");

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow.transition(" +
              JSON.stringify({ action: "approve_completion" }) +
              ")",
            exitCode: 0
          }
        }
      ]
    });

    const { prompts, readDoc, result, runs } = await simulation.run();
    const finalDoc = await readDoc();
    const finalTaskBoard = parseTaskBoard(finalDoc.body);

    expect(result.state).toBe("completed");
    expect(result.round).toBe(1);
    expect(result.reviewTurn).toBe(0);
    expect(prompts.length).toBe(4);
    expect(prompts[0]).toContain(absoluteDocPath);
    expect(prompts[1]).toContain(absoluteDocPath);
    expect(prompts[2]).toContain(builderSummary);
    expect(prompts[2]).toContain(inspectorSummary);
    expect(prompts[3]).toContain(superintendentSummary);
    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "codex",
      "claude-code"
    ]);
    expect(runs[0]?.mode).toBe("yolo");
    expect(finalDoc.frontmatter.status).toEqual({
      state: "completed",
      round: 1,
      review_turn: 0
    });
    expect(finalTaskBoard).toMatchObject({
      openCount: 0,
      doneCount: 2,
      allDone: true
    });
    expect(finalTaskBoard.tasks).toEqual([
      { text: "Task 1", done: true },
      { text: "Task 2", done: true }
    ]);
  });
});
