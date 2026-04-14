import { describe, expect, it } from "vitest";
import { parseTaskBoard } from "./document/tasks.js";
import { createSuperintendentSimulation } from "./testing/simulation.js";

const docPath = ".poe-code/superintendent/plans/happy-path.md";
const absoluteDocPath = "/repo/.poe-code/superintendent/plans/happy-path.md";

function createDoc(
  options: {
    tasksChecked?: boolean;
    tasks?: [boolean, boolean];
    builderPrompt?: string;
    inspectorPrompt?: string;
    superintendentPrompt?: string;
    ownerPrompt?: string;
  } = {}
): string {
  const tasks =
    options.tasks ?? [options.tasksChecked ?? false, options.tasksChecked ?? false];

  return [
    "---",
    "kind: superintendent",
    "version: 1",
    "builder:",
    "  agent: claude-code",
    "  mode: yolo",
    "  prompt: |",
    ...formatPromptBlock(options.builderPrompt ?? "Builder handles {{plan.path}}", "    "),
    "inspectors:",
    "  code-quality:",
    "    agent: codex",
    "    prompt: |",
    ...formatPromptBlock(
      options.inspectorPrompt ?? "Inspect {{plan.path}} after {{builder.summary}}",
      "      "
    ),
    "superintendent:",
    "  agent: codex",
    "  prompt: |",
    ...formatPromptBlock(
      options.superintendentPrompt ??
        "Superintendent review builder={{builder.summary}} inspector={{inspectors.code-quality}}",
      "    "
    ),
    "owner:",
    "  agent: claude-code",
    "  prompt: |",
    ...formatPromptBlock(options.ownerPrompt ?? "Owner review {{superintendent.summary}}", "    "),
    "status:",
    "  state: in_progress",
    "  round: 0",
    "  review_turn: 0",
    "---",
    "# Plan",
    "",
    "## Task Board",
    "",
    `- [${tasks[0] ? "x" : " "}] Task 1`,
    `- [${tasks[1] ? "x" : " "}] Task 2`,
    ""
  ].join("\n");
}

function formatPromptBlock(prompt: string, indent: string): string[] {
  return prompt.split("\n").map((line) => indent + line);
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

  it("replans after owner rejection and completes in the second round", async () => {
    const round1BuilderSummary = "Checked off Task 1 only";
    const round1InspectorSummary = "Task 2 still open";
    const round1SuperintendentSummary = "Ready for owner review";
    const ownerFeedback = "Task 2 is not done";
    const round2BuilderSummary = "Checked off Task 2";
    const round2InspectorSummary = "All tasks complete";
    const round2SuperintendentSummary = "Ready for owner review after round 2";
    const stateTransitions: string[] = [];

    const recordState = (state: string): void => {
      if (stateTransitions.at(-1) !== state) {
        stateTransitions.push(state);
      }
    };

    const builderPrompt = "Builder handles {{plan.path}}\nOwner feedback: {{owner.feedback}}";

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({ builderPrompt }),
      turns: [
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).not.toContain("{{plan.path}}");

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
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
            [docPath]: createDoc({ tasks: [true, false], builderPrompt })
          },
          output: {
            stdout: round1BuilderSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).toContain(round1BuilderSummary);

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 1,
              allDone: false
            });
          },
          output: {
            stdout: round1InspectorSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(round1BuilderSummary);
            expect(prompt).toContain(round1InspectorSummary);
            expect(prompt).not.toContain("{{builder.summary}}");
            expect(prompt).not.toContain("{{inspectors.code-quality}}");

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
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
                summary: round1SuperintendentSummary
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(round1SuperintendentSummary);
            expect(prompt).not.toContain("{{superintendent.summary}}");

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow.transition(" +
              JSON.stringify({ action: "request_changes", feedback: ownerFeedback }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).toContain(ownerFeedback);
            expect(prompt).not.toContain("{{owner.feedback}}");

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 1,
              allDone: false
            });
          },
          fileChanges: {
            [docPath]: createDoc({ tasks: [true, true], builderPrompt })
          },
          output: {
            stdout: round2BuilderSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).toContain(round2BuilderSummary);
            expect(prompt).not.toContain(round1BuilderSummary);

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 0,
              doneCount: 2,
              allDone: true
            });
          },
          output: {
            stdout: round2InspectorSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(round2BuilderSummary);
            expect(prompt).toContain(round2InspectorSummary);
            expect(prompt).not.toContain(round1BuilderSummary);
            expect(prompt).not.toContain(round1InspectorSummary);
            expect(prompt).not.toContain("{{builder.summary}}");
            expect(prompt).not.toContain("{{inspectors.code-quality}}");

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow.transition(" +
              JSON.stringify({
                action: "request_review",
                summary: round2SuperintendentSummary
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(round2SuperintendentSummary);
            expect(prompt).not.toContain("{{superintendent.summary}}");

            const doc = await ctx.readDoc();
            recordState(doc.frontmatter.status.state);
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 2,
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

    const { prompts, readDoc, result } = await simulation.run();
    const finalDoc = await readDoc();
    const finalTaskBoard = parseTaskBoard(finalDoc.body);

    recordState(result.state);

    expect(result.state).toBe("completed");
    expect(result.round).toBe(2);
    expect(prompts.length).toBe(8);
    expect(prompts[4]).toContain(ownerFeedback);
    expect(prompts[4]).not.toContain("{{owner.feedback}}");
    expect(stateTransitions).toEqual([
      "in_progress",
      "review",
      "in_progress",
      "review",
      "completed"
    ]);
    expect(finalDoc.frontmatter.status).toEqual({
      state: "completed",
      round: 2,
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
