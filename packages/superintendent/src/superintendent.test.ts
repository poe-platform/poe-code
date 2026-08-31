import { describe, expect, it } from "vitest";
import { parseTaskBoard } from "./document/tasks.js";
import {
  builderTurn,
  createSuperintendentSimulation,
  failTurn,
  inspectorTurn,
  ownerApproveTurn,
  superintendentTurn,
  type SimulationFailureContext
} from "./testing/simulation.js";

const docPath = ".poe-code/superintendent/happy-path.md";
const absoluteDocPath = "/repo/.poe-code/superintendent/happy-path.md";
const knownTemplateVariables = [
  "{{plan.path}}",
  "{{builder.summary}}",
  "{{builder.log}}",
  "{{inspectors.code-quality}}",
  "{{inspectors.dx}}",
  "{{superintendent.summary}}"
];

function createDoc(
  options: {
    tasksChecked?: boolean;
    tasks?: boolean[];
    builderPrompt?: string;
    inspectorPrompt?: string;
    includeManualQaInspector?: boolean;
    manualQaAgent?: string;
    manualQaPrompt?: string;
    extraInspectors?: Array<{
      name: string;
      agent: string;
      prompt: string;
    }>;
    superintendentPrompt?: string;
    superintendentAgent?: string;
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
    ...(options.includeManualQaInspector
      ? [
          "  manual-qa:",
          `    agent: ${options.manualQaAgent ?? "claude-code"}`,
          "    prompt: |",
          ...formatPromptBlock(
            options.manualQaPrompt ?? "Manual QA for {{plan.path}} after {{inspectors.code-quality}}",
            "      "
          )
        ]
      : []),
    ...(options.extraInspectors?.flatMap((inspector) => [
      `  ${inspector.name}:`,
      `    agent: ${inspector.agent}`,
      "    prompt: |",
      ...formatPromptBlock(inspector.prompt, "      ")
    ]) ?? []),
    "superintendent:",
    `  agent: ${options.superintendentAgent ?? "codex"}`,
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
    ...tasks.map((task, index) => `- [${task ? "x" : " "}] Task ${index + 1}`),
    ""
  ].join("\n");
}

function formatPromptBlock(prompt: string, indent: string): string[] {
  return prompt.split("\n").map((line) => indent + line);
}

function expectKnownTemplateVariablesResolved(prompt: string): void {
  for (const variable of knownTemplateVariables) {
    expect(prompt).not.toContain(variable);
  }
}

function readPromptLineValue(prompt: string, prefix: string): string {
  const line = prompt.split("\n").find((candidate) => candidate.startsWith(prefix));

  expect(line, `Expected prompt line starting with "${prefix}"`).toBeDefined();

  return line!.slice(prefix.length).trim();
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
              "workflow_transition(" +
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
              "workflow_transition(" +
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

  it("resolves each template variable at the execution phase where it becomes available", async () => {
    const builderSummary = "builder-ready";
    const builderLog = "built stuff";
    const codeQualitySummary = "quality-ok";
    const dxSummary = "dx-ok";
    const superintendentSummary = "all done";

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({
        tasks: [false],
        builderPrompt: "Work on {{plan.path}}",
        inspectorPrompt: "Inspect {{plan.path}}",
        extraInspectors: [
          {
            name: "dx",
            agent: "gemini",
            prompt: "Review DX. Build log: {{builder.log}}"
          }
        ],
        superintendentPrompt: [
          "Plan: {{plan.path}}",
          "Builder: {{builder.summary}}",
          "Log: {{builder.log}}",
          "Quality: {{inspectors.code-quality}}",
          "DX: {{inspectors.dx}}"
        ].join("\n"),
        ownerPrompt: [
          "Plan: {{plan.path}}",
          "Superintendent: {{superintendent.summary}}"
        ].join("\n")
      }),
      turns: [
        {
          assertPrompt: async (prompt, ctx) => {
            expectKnownTemplateVariablesResolved(prompt);
            expect(prompt.trim()).toBe(`Work on ${absoluteDocPath}`);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout: builderLog,
            summary: builderSummary,
            exitCode: 0
          }
        },
        inspectorTurn(codeQualitySummary, async (prompt, ctx) => {
          expectKnownTemplateVariablesResolved(prompt);
          expect(prompt).toContain(`Inspect ${absoluteDocPath}`);
          expect(prompt).toContain(`code-quality`);
          expect(prompt).toContain(builderSummary);

          const doc = await ctx.readDoc();
          expect(doc.frontmatter.status).toEqual({
            state: "in_progress",
            round: 1,
            review_turn: 0
          });
        }),
        inspectorTurn(dxSummary, async (prompt, ctx) => {
          expectKnownTemplateVariablesResolved(prompt);
          expect(prompt).toContain(`Review DX. Build log: ${builderLog}`);
          expect(prompt).toContain(`dx`);
          expect(prompt).toContain(builderSummary);

          const doc = await ctx.readDoc();
          expect(doc.frontmatter.status).toEqual({
            state: "in_progress",
            round: 1,
            review_turn: 0
          });
        }),
        superintendentTurn(
          { action: "request_review", summary: superintendentSummary },
          undefined,
          async (prompt, ctx) => {
            expectKnownTemplateVariablesResolved(prompt);
            expect(readPromptLineValue(prompt, "Plan: ")).toBe(absoluteDocPath);
            expect(readPromptLineValue(prompt, "Builder: ")).toBe(builderSummary);
            expect(readPromptLineValue(prompt, "Log: ")).toBe(builderLog);
            expect(readPromptLineValue(prompt, "Quality: ")).toBe(codeQualitySummary);
            expect(readPromptLineValue(prompt, "DX: ")).toBe(dxSummary);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
          }
        ),
        ownerApproveTurn(async (prompt, ctx) => {
          expectKnownTemplateVariablesResolved(prompt);
          expect(readPromptLineValue(prompt, "Plan: ")).toBe(absoluteDocPath);
          expect(readPromptLineValue(prompt, "Superintendent: ")).toBe(superintendentSummary);

          const doc = await ctx.readDoc();
          expect(doc.frontmatter.status).toEqual({
            state: "review",
            round: 1,
            review_turn: 0
          });
        })
      ]
    });

    const { prompts, result, runs } = await simulation.run();

    expect(result.state).toBe("completed");
    expect(result.round).toBe(1);
    expect(result.reviewTurn).toBe(0);
    expect(prompts).toHaveLength(5);
    prompts.forEach((prompt) => {
      expectKnownTemplateVariablesResolved(prompt);
    });
    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "gemini",
      "codex",
      "claude-code"
    ]);
  });

  it("runs three inspectors in definition order and passes their summaries to the superintendent", async () => {
    const builderLog = "Built feature X";
    const codeQualityAgent = "codex";
    const codeQualitySummary = "Code quality: A+";
    const manualQaAgent = "claude-code";
    const manualQaSummary = "Manual QA: all pass";
    const developerExperienceAgent = "gemini";
    const developerExperienceSummary = "DX: good ergonomics";
    const superintendentSummary = "Ready for owner review";

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({
        tasks: [false],
        includeManualQaInspector: true,
        manualQaAgent,
        extraInspectors: [
          {
            name: "developer-experience",
            agent: developerExperienceAgent,
            prompt: "Developer experience review {{builder.log}}"
          }
        ],
        superintendentPrompt: [
          "Superintendent review",
          "quality={{inspectors.code-quality}}",
          "manual={{inspectors.manual-qa}}",
          "dx={{inspectors.developer-experience}}"
        ].join("\n")
      }),
      turns: [
        { output: { stdout: builderLog, exitCode: 0 } },
        inspectorTurn(codeQualitySummary),
        inspectorTurn(manualQaSummary),
        inspectorTurn(developerExperienceSummary, async (prompt) => {
          expect(prompt).toContain(builderLog);
          expect(prompt).not.toContain("{{builder.log}}");
        }),
        superintendentTurn(
          { action: "request_review", summary: superintendentSummary },
          undefined,
          async (prompt) => {
            expect(prompt).toContain(codeQualitySummary);
            expect(prompt).toContain(manualQaSummary);
            expect(prompt).toContain(developerExperienceSummary);
            expect(prompt).not.toContain("{{inspectors.code-quality}}");
            expect(prompt).not.toContain("{{inspectors.manual-qa}}");
            expect(prompt).not.toContain("{{inspectors.developer-experience}}");
          }
        ),
        ownerApproveTurn()
      ]
    });

    const { result, runs } = await simulation.run();

    expect(runs.slice(1, 4).map((run) => run.agent)).toEqual([
      codeQualityAgent,
      manualQaAgent,
      developerExperienceAgent
    ]);
    expect(runs[1]?.agent).toBe(codeQualityAgent);
    expect(runs[2]?.agent).toBe(manualQaAgent);
    expect(runs[3]?.agent).toBe(developerExperienceAgent);
    expect(result.state).toBe("completed");
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
              "workflow_transition(" +
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
              "workflow_transition(" +
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
              "workflow_transition(" +
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
              "workflow_transition(" +
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

  it("writes the current runtime status back to the document after each phase", async () => {
    const round1BuilderSummary = "Checked off Task 1";
    const round1InspectorSummary = "Task 1 looks good";
    const round1SuperintendentSummary = "Ready for owner review";
    const ownerFeedback = "finish task 2";
    const round2BuilderSummary = "Checked off Task 2";
    const round2InspectorSummary = "All tasks complete";
    const round2SuperintendentSummary = "Ready for final owner review";

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({ tasks: [false, false] }),
      turns: [
        {
          assertPrompt: async (_prompt, ctx) => {
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
            [docPath]: createDoc({ tasks: [true, false] })
          },
          output: {
            stdout: round1BuilderSummary,
            exitCode: 0
          }
        },
        inspectorTurn(round1InspectorSummary, async (_prompt, ctx) => {
          const doc = await ctx.readDoc();

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
        }),
        superintendentTurn(
          { action: "request_review", summary: round1SuperintendentSummary },
          undefined,
          async (_prompt, ctx) => {
            const doc = await ctx.readDoc();

            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
          }
        ),
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();

            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({ action: "request_changes", feedback: ownerFeedback }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();

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
            [docPath]: createDoc({ tasks: [true, true] })
          },
          output: {
            stdout: round2BuilderSummary,
            exitCode: 0
          }
        },
        inspectorTurn(round2InspectorSummary, async (_prompt, ctx) => {
          const doc = await ctx.readDoc();

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
        }),
        superintendentTurn(
          { action: "request_review", summary: round2SuperintendentSummary },
          undefined,
          async (_prompt, ctx) => {
            const doc = await ctx.readDoc();

            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
          }
        ),
        ownerApproveTurn(async (_prompt, ctx) => {
          const doc = await ctx.readDoc();

          expect(doc.frontmatter.status).toEqual({
            state: "review",
            round: 2,
            review_turn: 0
          });
        })
      ]
    });

    const { readDoc, result } = await simulation.run();
    const finalDoc = await readDoc();
    const finalTaskBoard = parseTaskBoard(finalDoc.body);

    expect(result.state).toBe("completed");
    expect(result.round).toBe(2);
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

  it("stops at max_rounds without entering review when work stays in progress", async () => {
    const round1BuilderSummary = "Builder round 1 made progress";
    const round1InspectorSummary = "Task still open";
    const round2BuilderSummary = "Builder round 2 made progress";
    const round2InspectorSummary = "Still open";

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({ tasks: [false] }),
      maxRounds: 2,
      turns: [
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
              allDone: false
            });
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
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
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

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout: "Need another round",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
              allDone: false
            });
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
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
              allDone: false
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

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
          },
          output: {
            stdout: "Still planning",
            exitCode: 0
          }
        }
      ]
    });

    const { prompts, readDoc, result, runs } = await simulation.run();
    const finalDoc = await readDoc();
    const ownerTurns = runs.filter((run) => run.prompt.includes("Owner review "));

    expect(result.round).toBe(2);
    expect(result.state).toBe("in_progress");
    expect(result.state).not.toBe("completed");
    expect(result.stopReason).toBe("max_rounds");
    expect(prompts).toHaveLength(6);
    expect(ownerTurns).toHaveLength(0);
    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 2,
      review_turn: 0
    });
    expect(parseTaskBoard(finalDoc.body)).toMatchObject({
      openCount: 1,
      doneCount: 0,
      allDone: false
    });
  });

  it("stops after the builder when the abort signal fires mid-loop", async () => {
    const controller = new AbortController();
    const builderUpdatedDoc = createDoc({ tasks: [true] });

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({ tasks: [false] }),
      signal: controller.signal,
      turns: [
        builderTurn(
          {
            [docPath]: builderUpdatedDoc
          },
          async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).not.toContain("{{plan.path}}");

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
              allDone: false
            });

            controller.abort();
          }
        )
      ]
    });

    const { prompts, readDoc, result, runs } = await simulation.run();
    const finalDoc = await readDoc();
    const finalTaskBoard = parseTaskBoard(finalDoc.body);

    expect(prompts).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(result.stopReason).toBe("aborted");
    expect(result.state).toBe("in_progress");
    expect(result.state).not.toBe("completed");
    expect(result.stopReason).not.toBe("max_rounds");
    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 0,
      review_turn: 0
    });
    expect(finalTaskBoard).toMatchObject({
      openCount: 0,
      doneCount: 1,
      allDone: true
    });
    expect(finalTaskBoard.tasks).toEqual([{ text: "Task 1", done: true }]);
  });

  it("falls back to in_progress after the fifth owner rejection and completes in round 2", async () => {
    const round1BuilderSummary = "Checked off Task 1";
    const round1InspectorSummary = "Looks good";
    const round1SuperintendentSummary = "Ready for owner review";
    const reviewFeedback = [
      "fix formatting",
      "still not right",
      "nope",
      "try again",
      "no"
    ];
    const reviewPhaseSuperintendentSummaries = [
      "Re-requesting owner review 1",
      "Re-requesting owner review 2",
      "Re-requesting owner review 3",
      "Re-requesting owner review 4"
    ];
    const round2BuilderSummary = "Polished Task 1";
    const round2InspectorSummary = "All good";
    const round2SuperintendentSummary = "Ready for final owner review";
    const builderPrompt = "Builder handles {{plan.path}}\nOwner feedback: {{owner.feedback}}";
    const superintendentPrompt =
      "Superintendent review owner={{owner.feedback}} builder={{builder.summary}} inspector={{inspectors.code-quality}}";
    let reviewTurnAfterCap: number | undefined;

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: createDoc({ tasks: [false], builderPrompt, superintendentPrompt }),
      turns: [
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
              allDone: false
            });
          },
          fileChanges: {
            [docPath]: createDoc({ tasks: [true], builderPrompt, superintendentPrompt })
          },
          output: {
            stdout: round1BuilderSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(round1BuilderSummary);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 0,
              doneCount: 1,
              allDone: true
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

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({
                action: "request_review",
                summary: round1SuperintendentSummary
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({ action: "request_changes", feedback: reviewFeedback[0] }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(reviewFeedback[0]);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 1
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({
                action: "request_review",
                summary: reviewPhaseSuperintendentSummaries[0]
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 1
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({ action: "request_changes", feedback: reviewFeedback[1] }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(reviewFeedback[1]);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 2
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({
                action: "request_review",
                summary: reviewPhaseSuperintendentSummaries[1]
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 2
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({ action: "request_changes", feedback: reviewFeedback[2] }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(reviewFeedback[2]);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 3
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({
                action: "request_review",
                summary: reviewPhaseSuperintendentSummaries[2]
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 3
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({ action: "request_changes", feedback: reviewFeedback[3] }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(reviewFeedback[3]);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 4
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({
                action: "request_review",
                summary: reviewPhaseSuperintendentSummaries[3]
              }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (_prompt, ctx) => {
            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 1,
              review_turn: 4
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
              JSON.stringify({ action: "request_changes", feedback: reviewFeedback[4] }) +
              ")",
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            reviewTurnAfterCap = (await ctx.readDoc()).frontmatter.status.review_turn;
            expect((await ctx.readDoc()).frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
            expect(prompt).toContain(reviewFeedback[4]);
          },
          fileChanges: {
            [docPath]: createDoc({ tasks: [true], builderPrompt, superintendentPrompt })
          },
          output: {
            stdout: round2BuilderSummary,
            exitCode: 0
          }
        },
        {
          assertPrompt: async (prompt, ctx) => {
            expect(prompt).toContain(round2BuilderSummary);

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 0,
              doneCount: 1,
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

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 2,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
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

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "review",
              round: 2,
              review_turn: 0
            });
          },
          output: {
            stdout:
              "workflow_transition(" +
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
    const reviewPhaseRuns = runs.slice(3, 12);

    expect(result.state).toBe("completed");
    expect(result.round).toBe(2);
    expect(reviewTurnAfterCap).toBe(0);
    expect(result.reviewTurn).toBe(0);
    expect(prompts).toHaveLength(16);
    expect(
      reviewPhaseRuns.map((run) =>
        run.prompt.includes("Owner review ") ? "owner" : "superintendent"
      )
    ).toEqual([
      "owner",
      "superintendent",
      "owner",
      "superintendent",
      "owner",
      "superintendent",
      "owner",
      "superintendent",
      "owner"
    ]);
    expect(reviewPhaseRuns.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "claude-code",
      "codex",
      "claude-code",
      "codex",
      "claude-code",
      "codex",
      "claude-code"
    ]);
    expect(finalDoc.frontmatter.status).toEqual({
      state: "completed",
      round: 2,
      review_turn: 0
    });
    expect(finalTaskBoard).toMatchObject({
      openCount: 0,
      doneCount: 1,
      allDone: true
    });
    expect(finalTaskBoard.tasks).toEqual([{ text: "Task 1", done: true }]);
  });

  it("surfaces builder failure, halts the round, and saves the pre-round document for recovery", async () => {
    const initialDoc = createDoc({ tasks: [false] });

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: initialDoc,
      turns: [
        failTurn("Process exited with code 1", async (prompt, ctx) => {
          expect(prompt).toContain(absoluteDocPath);
          expect(prompt).not.toContain("{{plan.path}}");

          const doc = await ctx.readDoc();
          expect(doc.frontmatter.status).toEqual({
            state: "in_progress",
            round: 1,
            review_turn: 0
          });
          expect(parseTaskBoard(doc.body)).toMatchObject({
            openCount: 1,
            doneCount: 0,
            allDone: false
          });
        })
      ]
    });

    let error: (Error & Partial<SimulationFailureContext>) | undefined;

    try {
      await simulation.run();
    } catch (thrown) {
      error = thrown as typeof error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain("Process exited with code 1");
    expect(error?.prompts).toHaveLength(1);

    const finalDoc = await error!.readDoc!();
    const finalTaskBoard = parseTaskBoard(finalDoc.body);

    const backups = (await error!.fs!.readdir("/repo/.poe-code/superintendent")).filter((name) =>
      name.endsWith(".bak")
    );
    expect(backups).toHaveLength(1);
    expect(await error!.readFile!(`.poe-code/superintendent/${backups[0]}`)).toBe(initialDoc);
    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 1,
      review_turn: 0
    });
    expect(finalTaskBoard).toMatchObject({
      openCount: 1,
      doneCount: 0,
      allDone: false
    });
    expect(finalTaskBoard.tasks).toEqual([{ text: "Task 1", done: false }]);
  });

  it("surfaces an inspector failure after builder completion, skips the superintendent, and keeps builder edits", async () => {
    const manualQaAgent = "claude-code";
    const superintendentAgent = "gemini";
    const codeQualitySummary = "all good";
    const superintendentPrompt =
      "Superintendent review builder={{builder.summary}} inspector={{inspectors.code-quality}} manual={{inspectors.manual-qa}}";
    const inspectorDoc = createDoc({
      tasks: [false],
      includeManualQaInspector: true,
      manualQaAgent,
      superintendentAgent,
      superintendentPrompt
    });
    const builderUpdatedDoc = createDoc({
      tasks: [true],
      includeManualQaInspector: true,
      manualQaAgent,
      superintendentAgent,
      superintendentPrompt
    });

    const simulation = createSuperintendentSimulation({
      docPath,
      docContent: inspectorDoc,
      turns: [
        builderTurn(
          {
            [docPath]: builderUpdatedDoc
          },
          async (prompt, ctx) => {
            expect(prompt).toContain(absoluteDocPath);
            expect(prompt).not.toContain("{{plan.path}}");

            const doc = await ctx.readDoc();
            expect(doc.frontmatter.status).toEqual({
              state: "in_progress",
              round: 1,
              review_turn: 0
            });
            expect(parseTaskBoard(doc.body)).toMatchObject({
              openCount: 1,
              doneCount: 0,
              allDone: false
            });
          }
        ),
        inspectorTurn(codeQualitySummary, async (prompt, ctx) => {
          expect(prompt).toContain(absoluteDocPath);
          expect(prompt).not.toContain("{{plan.path}}");

          const doc = await ctx.readDoc();
          expect(doc.frontmatter.status).toEqual({
            state: "in_progress",
            round: 1,
            review_turn: 0
          });
          expect(parseTaskBoard(doc.body)).toMatchObject({
            openCount: 0,
            doneCount: 1,
            allDone: true
          });
        }),
        failTurn("timeout", async (prompt, ctx) => {
          expect(prompt).toContain(absoluteDocPath);
          expect(prompt).toContain(codeQualitySummary);
          expect(prompt).not.toContain("{{inspectors.code-quality}}");

          const doc = await ctx.readDoc();
          expect(doc.frontmatter.status).toEqual({
            state: "in_progress",
            round: 1,
            review_turn: 0
          });
          expect(parseTaskBoard(doc.body)).toMatchObject({
            openCount: 0,
            doneCount: 1,
            allDone: true
          });
        })
      ]
    });

    let error: (Error & Partial<SimulationFailureContext>) | undefined;

    try {
      await simulation.run();
    } catch (thrown) {
      error = thrown as typeof error;
    }

    expect(error).toBeDefined();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("timeout");
    expect(error?.prompts).toHaveLength(3);
    expect(error?.runs).toHaveLength(3);
    expect(error?.runs?.[2]?.agent).toBe(manualQaAgent);
    expect(error?.runs?.some((run) => run.agent === superintendentAgent)).toBe(false);

    const finalDoc = await error!.readDoc!();
    const finalTaskBoard = parseTaskBoard(finalDoc.body);

    expect(finalDoc.frontmatter.status).toEqual({
      state: "in_progress",
      round: 1,
      review_turn: 0
    });
    expect(finalTaskBoard).toMatchObject({
      openCount: 0,
      doneCount: 1,
      allDone: true
    });
    expect(finalTaskBoard.tasks).toEqual([{ text: "Task 1", done: true }]);
  });
});
