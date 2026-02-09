import { describe, it, expect } from "vitest";
import {
  createRalphSimulation,
  completeTurn,
  incompleteTurn,
  failTurn,
  type TurnSpec
} from "./simulation.js";

// Scenario builder helpers
function retriesBeforeSuccess(retries: number): TurnSpec[] {
  return [
    ...Array(retries).fill(null).map((_, i) => failTurn(`retry ${i + 1}`)),
    completeTurn()
  ];
}

function incompleteProgress(turns: number): TurnSpec[] {
  return Array(turns).fill(null).map((_, i) => incompleteTurn(`progress ${i + 1}`));
}

describe("createRalphSimulation", () => {
  describe("basic turn flow", () => {
    it("completes a story when agent outputs COMPLETE", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "First feature" }]
        },
        turns: [completeTurn()]
      });

      const { result, prompts, readPlan } = await sim.run();

      expect(result.storiesDone).toEqual(["US-001"]);
      expect(result.stopReason).toBe("no_actionable_stories");
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("US-001");

      const prd = await readPlan();
      expect(prd.stories[0]?.status).toBe("done");
    });

    it("keeps story open when agent output is incomplete", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "First feature" }]
        },
        config: { maxIterations: 2 },
        turns: [
          incompleteTurn("working on it..."),
          completeTurn()
        ]
      });

      const { result, prompts, getStory } = await sim.run();

      expect(result.storiesDone).toEqual(["US-001"]);
      expect(result.iterationsCompleted).toBe(2);
      expect(prompts).toHaveLength(2);

      const story = await getStory("US-001");
      expect(story?.status).toBe("done");
    });

    it("keeps story open when agent fails", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "First feature" }]
        },
        config: { maxIterations: 1 },
        turns: [failTurn("error: something broke")]
      });

      const { result, getStory, readFile } = await sim.run();

      expect(result.storiesDone).toEqual([]);
      expect(result.iterations[0]?.status).toBe("failure");

      const story = await getStory("US-001");
      expect(story?.status).toBe("open");

      const errorsLog = await readFile(".poe-code-ralph/errors.log");
      expect(errorsLog).toContain("something broke");
    });
  });

  describe("prompt assertions", () => {
    it("allows asserting prompt content at each turn", async () => {
      const promptAssertions: string[] = [];

      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "First feature" },
            { id: "US-002", title: "Second feature" }
          ]
        },
        turns: [
          {
            assertPrompt: (prompt) => {
              promptAssertions.push("turn1");
              expect(prompt).toContain("US-001");
              expect(prompt).toContain("First feature");
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          {
            assertPrompt: (prompt) => {
              promptAssertions.push("turn2");
              expect(prompt).toContain("US-002");
              expect(prompt).toContain("Second feature");
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      const { result } = await sim.run();

      expect(promptAssertions).toEqual(["turn1", "turn2"]);
      expect(result.storiesDone).toEqual(["US-001", "US-002"]);
    });

    it("provides turn context for advanced assertions", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "First feature" }]
        },
        turns: [
          {
            assertPrompt: async (_prompt, ctx) => {
              expect(ctx.iteration).toBe(1);
              expect(ctx.storyId).toBe("US-001");

              const prd = await ctx.readPlan();
              expect(prd.stories[0]?.status).toBe("in_progress");
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      await sim.run();
    });
  });

  describe("file changes", () => {
    it("applies file changes before agent output", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Add feature" }]
        },
        turns: [
          {
            fileChanges: {
              "src/feature.ts": "export const feature = true;",
              "src/feature.test.ts": "test('feature', () => {});"
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      const { readFile } = await sim.run();

      const feature = await readFile("src/feature.ts");
      expect(feature).toBe("export const feature = true;");

      const test = await readFile("src/feature.test.ts");
      expect(test).toBe("test('feature', () => {});");
    });

    it("can read files created in previous turns", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Multi-step feature" }]
        },
        config: { maxIterations: 2 },
        turns: [
          {
            fileChanges: {
              "src/step1.ts": "export const step1 = true;"
            },
            output: { stdout: "step 1 done" }
          },
          {
            assertPrompt: async (_prompt, ctx) => {
              const step1 = await ctx.readFile("src/step1.ts");
              expect(step1).toBe("export const step1 = true;");
            },
            fileChanges: {
              "src/step2.ts": "import { step1 } from './step1';"
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      await sim.run();
    });
  });

  describe("overbake detection", () => {
    it("detects overbaking after consecutive failures", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Flaky story" }]
        },
        config: { maxFailures: 3, maxIterations: 3 },
        turns: [
          failTurn("error 1"),
          failTurn("error 2"),
          failTurn("error 3")
        ]
      });

      const { overbakeWarnings } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(overbakeWarnings[0]).toMatchObject({
        storyId: "US-001",
        consecutiveFailures: 3,
        threshold: 3
      });
    });

    it("resets failure count on success", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Intermittent story" }]
        },
        config: { maxFailures: 3, maxIterations: 5 },
        turns: [
          failTurn("error 1"),
          completeTurn(),
          failTurn("error 2"),
          completeTurn()
        ]
      });

      const { overbakeWarnings, result } = await sim.run();

      expect(overbakeWarnings).toHaveLength(0);
      expect(result.storiesDone).toEqual(["US-001"]);
    });

    it("counts incomplete toward overbaking threshold", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Stuck story" }]
        },
        config: { maxFailures: 3, maxIterations: 5 },
        turns: [
          incompleteTurn("no progress 1"),
          incompleteTurn("no progress 2"),
          incompleteTurn("no progress 3")
        ]
      });

      const { overbakeWarnings } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(overbakeWarnings[0]).toMatchObject({
        storyId: "US-001",
        consecutiveFailures: 3,
        threshold: 3
      });
    });

    it("counts mixed failure and incomplete toward threshold", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Mixed non-success" }]
        },
        config: { maxFailures: 3, maxIterations: 5 },
        turns: [
          failTurn("error"),
          incompleteTurn("no progress"),
          failTurn("error again")
        ]
      });

      const { overbakeWarnings } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(overbakeWarnings[0]).toMatchObject({
        storyId: "US-001",
        consecutiveFailures: 3,
        threshold: 3
      });
    });

    it("incomplete does not reset failure streak", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Subtle bug" }]
        },
        config: { maxFailures: 2, maxIterations: 3 },
        turns: [
          failTurn("crash"),
          incompleteTurn("still stuck"),
          failTurn("crash again")
        ]
      });

      const { overbakeWarnings } = await sim.run();

      // failure(1) + incomplete(2) triggers overbake at turn 2, not reset
      expect(overbakeWarnings).toHaveLength(1);
      expect(overbakeWarnings[0]).toMatchObject({
        consecutiveFailures: 2
      });
    });

    it("skips story on incomplete-triggered overbake", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "Stuck story" },
            { id: "US-002", title: "Next story" }
          ]
        },
        config: { maxFailures: 2, maxIterations: 4 },
        onOverbake: "skip",
        turns: [
          incompleteTurn("no progress 1"),
          incompleteTurn("no progress 2"),
          completeTurn((prompt) => expect(prompt).toContain("US-002"))
        ]
      });

      const { result, overbakeWarnings, getStory } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(result.storiesDone).toEqual(["US-002"]);
      expect((await getStory("US-001"))?.status).toBe("open");
    });

    it("aborts run on incomplete-triggered overbake", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Stuck story" }]
        },
        config: { maxFailures: 2, maxIterations: 10 },
        onOverbake: "abort",
        turns: [
          incompleteTurn("no progress 1"),
          incompleteTurn("no progress 2")
        ]
      });

      const { result, overbakeWarnings } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(result.stopReason).toBe("overbake_abort");
      expect(result.iterationsCompleted).toBe(2);
    });

    it("skips story when onOverbake returns skip", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "Problematic story" },
            { id: "US-002", title: "Next story" }
          ]
        },
        config: { maxFailures: 2, maxIterations: 4 },
        onOverbake: "skip",
        turns: [
          failTurn("error 1"),
          failTurn("error 2"),
          // After skip, moves to US-002
          completeTurn((prompt) => expect(prompt).toContain("US-002"))
        ]
      });

      const { result, overbakeWarnings, getStory } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(result.storiesDone).toEqual(["US-002"]);
      expect((await getStory("US-001"))?.status).toBe("open");
    });

    it("aborts run when onOverbake returns abort", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Problematic story" }]
        },
        config: { maxFailures: 2, maxIterations: 10 },
        onOverbake: "abort",
        turns: [
          failTurn("error 1"),
          failTurn("error 2")
        ]
      });

      const { result, overbakeWarnings } = await sim.run();

      expect(overbakeWarnings).toHaveLength(1);
      expect(result.stopReason).toBe("overbake_abort");
      expect(result.iterationsCompleted).toBe(2);
    });

    it("supports dynamic onOverbake callback", async () => {
      let callCount = 0;
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Problematic story" }]
        },
        config: { maxFailures: 2, maxIterations: 3 },
        onOverbake: (warning) => {
          callCount++;
          // Abort on first overbake
          return warning.consecutiveFailures >= 2 ? "abort" : "continue";
        },
        turns: [
          failTurn("error 1"),
          failTurn("error 2") // triggers overbake at threshold 2, aborts
        ]
      });

      const { result, overbakeWarnings } = await sim.run();

      expect(callCount).toBe(1);
      expect(overbakeWarnings[0]?.consecutiveFailures).toBe(2);
      expect(result.stopReason).toBe("overbake_abort");
    });
  });

  describe("multi-story scenarios", () => {
    it("moves to next story after completing one", async () => {
      const storyOrder: string[] = [];

      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "First" },
            { id: "US-002", title: "Second" },
            { id: "US-003", title: "Third" }
          ]
        },
        turns: [
          {
            assertPrompt: (prompt) => {
              const match = prompt.match(/Story:\s*(\S+)/);
              if (match) storyOrder.push(match[1]!);
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          {
            assertPrompt: (prompt) => {
              const match = prompt.match(/Story:\s*(\S+)/);
              if (match) storyOrder.push(match[1]!);
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          {
            assertPrompt: (prompt) => {
              const match = prompt.match(/Story:\s*(\S+)/);
              if (match) storyOrder.push(match[1]!);
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      const { result } = await sim.run();

      expect(storyOrder).toEqual(["US-001", "US-002", "US-003"]);
      expect(result.storiesDone).toEqual(["US-001", "US-002", "US-003"]);
    });

    it("respects story dependencies", async () => {
      const storyOrder: string[] = [];

      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-002", title: "Second", dependsOn: ["US-001"] },
            { id: "US-001", title: "First" }
          ]
        },
        turns: [
          {
            assertPrompt: (prompt) => {
              const match = prompt.match(/Story:\s*(\S+)/);
              if (match) storyOrder.push(match[1]!);
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          {
            assertPrompt: (prompt) => {
              const match = prompt.match(/Story:\s*(\S+)/);
              if (match) storyOrder.push(match[1]!);
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      await sim.run();

      expect(storyOrder).toEqual(["US-001", "US-002"]);
    });
  });

  describe("helper functions", () => {
    it("completeTurn creates a successful completion", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        turns: [
          completeTurn(
            (prompt) => expect(prompt).toContain("US-001"),
            { "src/file.ts": "content" }
          )
        ]
      });

      const { result, readFile } = await sim.run();
      expect(result.storiesDone).toEqual(["US-001"]);
      expect(await readFile("src/file.ts")).toBe("content");
    });

    it("incompleteTurn creates non-completing output", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        config: { maxIterations: 1 },
        turns: [incompleteTurn("still working...")]
      });

      const { result, getStory } = await sim.run();
      expect(result.iterations[0]?.status).toBe("incomplete");
      expect((await getStory("US-001"))?.status).toBe("open");
    });

    it("failTurn creates a failure", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        config: { maxIterations: 1 },
        turns: [failTurn("crash!")]
      });

      const { result, readFile } = await sim.run();
      expect(result.iterations[0]?.status).toBe("failure");
      expect(await readFile(".poe-code-ralph/errors.log")).toContain("crash!");
    });
  });

  describe("custom configuration", () => {
    it("uses custom prompt template", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        promptTemplate: "CUSTOM: {{STORY_ID}} - {{STORY_TITLE}}",
        turns: [
          {
            assertPrompt: (prompt) => {
              expect(prompt).toBe("CUSTOM: US-001 - Test");
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      await sim.run();
    });

    it("includes custom initial files", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        files: {
          "existing/file.ts": "existing content",
          "/absolute/path.ts": "absolute content"
        },
        turns: [
          {
            assertPrompt: async (_prompt, ctx) => {
              expect(await ctx.readFile("existing/file.ts")).toBe("existing content");
              expect(await ctx.readFile("/absolute/path.ts")).toBe("absolute content");
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      await sim.run();
    });

    it("uses custom paths for state files", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        config: {
          progressPath: "custom/progress.md",
          guardrailsPath: "custom/guardrails.md",
          errorsLogPath: "custom/errors.log"
        },
        turns: [failTurn("custom error")]
      });

      const { readFile, prompts } = await sim.run();

      expect(prompts[0]).toContain("Progress: /custom/progress.md");
      expect(prompts[0]).toContain("Guardrails: /custom/guardrails.md");
      expect(prompts[0]).toContain("Errors: /custom/errors.log");
      expect(await readFile("custom/errors.log")).toContain("custom error");
    });
  });

  describe("timestamps and metadata", () => {
    it("sets story timestamps when completed", async () => {
      const fixedDate = new Date("2026-03-15T10:30:00.000Z");

      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Test" }]
        },
        now: fixedDate,
        turns: [completeTurn()]
      });

      const { getStory } = await sim.run();
      const story = await getStory("US-001");

      expect(story?.status).toBe("done");
      expect(story?.startedAt).toBe(fixedDate.toISOString());
      expect(story?.completedAt).toBe(fixedDate.toISOString());
    });

    it("preserves startedAt when story fails and retries", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Test" }]
        },
        config: { maxIterations: 2 },
        turns: [
          failTurn("first attempt"),
          completeTurn()
        ]
      });

      const { getStory } = await sim.run();
      const story = await getStory("US-001");

      expect(story?.status).toBe("done");
      expect(story?.startedAt).toBeTruthy();
      expect(story?.completedAt).toBeTruthy();
    });

    it("provides readRunLog for iteration logs", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        runId: "my-run-123",
        turns: [
          {
            output: { stdout: "agent output here", stderr: "" }
          }
        ]
      });

      const { readRunLog } = await sim.run();
      const log = await readRunLog(1);

      expect(log).toContain("agent output here");
    });

    it("provides readRunMeta for iteration metadata", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        runId: "my-run-123",
        turns: [completeTurn()]
      });

      const { readRunMeta } = await sim.run();
      const meta = await readRunMeta(1);

      expect(meta).toContain("- Story: US-001: Test");
      expect(meta).toContain("- Status: success");
      expect(meta).toContain("my-run-123");
    });

    it("uses custom runId in file paths", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        runId: "custom-run-456",
        turns: [completeTurn()]
      });

      const { result } = await sim.run();

      expect(result.runId).toBe("custom-run-456");
      expect(result.iterations[0]?.logPath).toContain("custom-run-456");
      expect(result.iterations[0]?.metaPath).toContain("custom-run-456");
    });
  });

  describe("edge cases", () => {
    it("fails remaining iterations when fewer turns defined than maxIterations", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        config: { maxIterations: 3 },
        turns: [incompleteTurn("once")]
      });

      const { result, readFile } = await sim.run();

      // First iteration is incomplete, subsequent iterations fail because no turn is defined
      expect(result.iterations[0]?.status).toBe("incomplete");
      expect(result.iterations[1]?.status).toBe("failure");
      expect(result.iterations[2]?.status).toBe("failure");

      const errorsLog = await readFile(".poe-code-ralph/errors.log");
      expect(errorsLog).toContain("unexpected turn 2");
    });

    it("handles empty plan gracefully", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [] },
        config: { maxIterations: 1 },
        turns: []
      });

      const { result } = await sim.run();
      expect(result.stopReason).toBe("no_actionable_stories");
      expect(result.iterationsCompleted).toBe(0);
    });

    it("exposes spawn mock for additional assertions", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        config: { agent: "custom-agent" },
        turns: [completeTurn()]
      });

      await sim.run();

      expect(sim.spawnMock).toHaveBeenCalledWith(
        "custom-agent",
        expect.objectContaining({ useStdin: true })
      );
    });
  });

  describe("real-world scenarios", () => {
    it("agent makes incremental progress over multiple turns", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{
            id: "US-001",
            title: "Add user authentication",
            acceptanceCriteria: ["Login endpoint works", "Logout endpoint works", "Tests pass"]
          }]
        },
        config: { maxIterations: 3 },
        turns: [
          // Turn 1: Agent creates login endpoint
          {
            assertPrompt: (prompt) => {
              expect(prompt).toContain("Login endpoint");
              expect(prompt).toContain("Logout endpoint");
            },
            fileChanges: { "src/auth/login.ts": "export function login() { return true; }" },
            output: { stdout: "Created login endpoint, continuing with logout..." }
          },
          // Turn 2: Agent creates logout endpoint
          {
            assertPrompt: async (_prompt, ctx) => {
              // Verify agent can see previous work
              const login = await ctx.readFile("src/auth/login.ts");
              expect(login).toContain("login");
            },
            fileChanges: {
              "src/auth/logout.ts": "export function logout() { return true; }",
              "src/auth/auth.test.ts": "test('auth works', () => expect(true).toBe(true));"
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      const { result, readFile } = await sim.run();

      expect(result.storiesDone).toEqual(["US-001"]);
      expect(result.iterationsCompleted).toBe(2);

      // Verify all files were created
      expect(await readFile("src/auth/login.ts")).toContain("login");
      expect(await readFile("src/auth/logout.ts")).toContain("logout");
      expect(await readFile("src/auth/auth.test.ts")).toContain("test");
    });

    it("agent recovers from test failure", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Fix critical bug" }],
          qualityGates: ["npm test", "npm run lint"]
        },
        config: { maxIterations: 3 },
        turns: [
          // Turn 1: Agent writes buggy code, tests fail
          {
            fileChanges: { "src/feature.ts": "export const buggy = null;" },
            output: { stdout: "Implemented feature", stderr: "TypeError: Cannot read property of null", exitCode: 1 }
          },
          // Turn 2: Agent fixes the bug
          {
            assertPrompt: (prompt) => {
              // Prompt should include quality gates
              expect(prompt).toContain("npm test");
              expect(prompt).toContain("npm run lint");
            },
            fileChanges: { "src/feature.ts": "export const fixed = { value: 42 };" },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      const { result, readFile } = await sim.run();

      expect(result.storiesDone).toEqual(["US-001"]);
      expect(result.iterations[0]?.status).toBe("failure");
      expect(result.iterations[1]?.status).toBe("success");

      // Bug was fixed
      const feature = await readFile("src/feature.ts");
      expect(feature).toContain("fixed");
      expect(feature).not.toContain("null");
    });

    it("completes multiple dependent stories in order", async () => {
      const completedOrder: string[] = [];

      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-003", title: "Add UI", dependsOn: ["US-002"] },
            { id: "US-002", title: "Add API", dependsOn: ["US-001"] },
            { id: "US-001", title: "Add database schema" }
          ]
        },
        turns: [
          // US-001 first (no deps)
          {
            assertPrompt: (p) => expect(p).toContain("US-001"),
            fileChanges: { "db/schema.sql": "CREATE TABLE users;" },
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          // US-002 second (depends on US-001)
          {
            assertPrompt: async (p, ctx) => {
              expect(p).toContain("US-002");
              // Can see schema from US-001
              expect(await ctx.readFile("db/schema.sql")).toContain("CREATE TABLE");
            },
            fileChanges: { "src/api/users.ts": "export const getUsers = () => [];" },
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          // US-003 last (depends on US-002)
          {
            assertPrompt: async (p, ctx) => {
              expect(p).toContain("US-003");
              // Can see API from US-002
              expect(await ctx.readFile("src/api/users.ts")).toContain("getUsers");
            },
            fileChanges: { "src/ui/UserList.tsx": "export const UserList = () => <div/>;" },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ].map((turn, i) => ({
          ...turn,
          assertPrompt: async (p: string, ctx: any) => {
            await turn.assertPrompt?.(p, ctx);
            const match = p.match(/Story:\s*(\S+)/);
            if (match) completedOrder.push(match[1]!);
          }
        }))
      });

      const { result } = await sim.run();

      expect(completedOrder).toEqual(["US-001", "US-002", "US-003"]);
      expect(result.storiesDone).toEqual(["US-001", "US-002", "US-003"]);
    });

    it("agent stuck in loop: exits 0 but never completes (no registry access)", async () => {
      // Simulates the exact production bug: agent finds dep already installed,
      // tries pnpm install to verify, fails with ENOTFOUND, exits 0 without COMPLETE.
      // Previously this would loop forever because "incomplete" reset the overbake counter.
      const sim = createRalphSimulation({
        plan: {
          stories: [{ id: "US-001", title: "Install ai-sdk-provider-poe" }],
          qualityGates: ["pnpm install", "pnpm test", "pnpm run lint"]
        },
        config: { maxFailures: 3, maxIterations: 30 },
        onOverbake: "skip",
        turns: [
          incompleteTurn("dep already in package.json, pnpm install ENOTFOUND"),
          incompleteTurn("dep already in package.json, pnpm install ENOTFOUND"),
          incompleteTurn("dep already in package.json, pnpm install ENOTFOUND")
        ]
      });

      const { result, overbakeWarnings } = await sim.run();

      // Overbake triggers after 3 incompletes, story gets skipped, loop stops
      expect(overbakeWarnings).toHaveLength(1);
      expect(overbakeWarnings[0]).toMatchObject({
        storyId: "US-001",
        consecutiveFailures: 3
      });
      expect(result.iterationsCompleted).toBe(3);
      expect(result.stopReason).toBe("no_actionable_stories");
      expect(result.storiesDone).toEqual([]);
    });

    it("handles flaky story that eventually succeeds", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Flaky integration" }] },
        config: { maxIterations: 5, maxFailures: 4 },
        turns: retriesBeforeSuccess(3)
      });

      const { result, overbakeWarnings } = await sim.run();

      expect(result.storiesDone).toEqual(["US-001"]);
      expect(result.iterationsCompleted).toBe(4);
      expect(overbakeWarnings).toHaveLength(0); // didn't hit threshold
    });
  });

  describe("Plan state transitions", () => {
    it("story transitions: open → in_progress → open on failure", async () => {
      const states: string[] = [];

      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        config: { maxIterations: 1 },
        turns: [{
          assertPrompt: async (_p, ctx) => {
            const story = (await ctx.readPlan()).stories[0];
            states.push(`during: ${story?.status}`);
          },
          output: { stdout: "failed", exitCode: 1 }
        }]
      });

      const { getStory } = await sim.run();
      states.push(`after: ${(await getStory("US-001"))?.status}`);

      expect(states).toEqual(["during: in_progress", "after: open"]);
    });

    it("story transitions: open → in_progress → done on success", async () => {
      const states: string[] = [];

      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Test" }] },
        turns: [{
          assertPrompt: async (_p, ctx) => {
            const story = (await ctx.readPlan()).stories[0];
            states.push(`during: ${story?.status}`);
          },
          output: { stdout: "<promise>COMPLETE</promise>" }
        }]
      });

      const { getStory } = await sim.run();
      states.push(`after: ${(await getStory("US-001"))?.status}`);

      expect(states).toEqual(["during: in_progress", "after: done"]);
    });

    it("blocked story waits until dependency is done", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-002", title: "Depends on 001", dependsOn: ["US-001"] },
            { id: "US-001", title: "Base feature" }
          ]
        },
        config: { maxIterations: 3 },
        turns: [
          // First turn: US-001 is incomplete
          {
            assertPrompt: (p) => expect(p).toContain("US-001"),
            output: { stdout: "working..." }
          },
          // Second turn: US-001 completes
          {
            assertPrompt: (p) => expect(p).toContain("US-001"),
            output: { stdout: "<promise>COMPLETE</promise>" }
          },
          // Third turn: now US-002 is unblocked
          {
            assertPrompt: (p) => expect(p).toContain("US-002"),
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      const { result } = await sim.run();
      expect(result.storiesDone).toEqual(["US-001", "US-002"]);
    });

    it("story with multiple dependencies waits for all", async () => {
      const storyOrder: string[] = [];

      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-003", title: "Final", dependsOn: ["US-001", "US-002"] },
            { id: "US-001", title: "First" },
            { id: "US-002", title: "Second" }
          ]
        },
        turns: [
          { assertPrompt: (p) => { if (p.includes("US-001")) storyOrder.push("US-001"); }, output: { stdout: "<promise>COMPLETE</promise>" } },
          { assertPrompt: (p) => { if (p.includes("US-002")) storyOrder.push("US-002"); }, output: { stdout: "<promise>COMPLETE</promise>" } },
          { assertPrompt: (p) => { if (p.includes("US-003")) storyOrder.push("US-003"); }, output: { stdout: "<promise>COMPLETE</promise>" } }
        ]
      });

      await sim.run();

      // US-003 must come after both US-001 and US-002
      expect(storyOrder.indexOf("US-003")).toBeGreaterThan(storyOrder.indexOf("US-001"));
      expect(storyOrder.indexOf("US-003")).toBeGreaterThan(storyOrder.indexOf("US-002"));
    });
  });

  describe("scenario builder helpers", () => {
    it("retriesBeforeSuccess simulates flaky then success", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Flaky" }] },
        config: { maxIterations: 5 },
        turns: retriesBeforeSuccess(3)
      });

      const { result } = await sim.run();

      expect(result.storiesDone).toEqual(["US-001"]);
      expect(result.iterationsCompleted).toBe(4); // 3 failures + 1 success
      expect(result.iterations.filter(i => i.status === "failure")).toHaveLength(3);
      expect(result.iterations.filter(i => i.status === "success")).toHaveLength(1);
    });

    it("incompleteProgress simulates ongoing work", async () => {
      const sim = createRalphSimulation({
        plan: { stories: [{ id: "US-001", title: "Long task" }] },
        config: { maxIterations: 3 },
        turns: incompleteProgress(3)
      });

      const { result, getStory } = await sim.run();

      expect(result.iterationsCompleted).toBe(3);
      expect(result.iterations.every(i => i.status === "incomplete")).toBe(true);
      expect((await getStory("US-001"))?.status).toBe("open");
    });
  });

  describe("prompt content verification", () => {
    it("prompt includes all acceptance criteria", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{
            id: "US-001",
            title: "Feature with criteria",
            acceptanceCriteria: [
              "Criterion A must pass",
              "Criterion B must pass",
              "Criterion C must pass"
            ]
          }]
        },
        turns: [{
          assertPrompt: (prompt) => {
            expect(prompt).toContain("Criterion A must pass");
            expect(prompt).toContain("Criterion B must pass");
            expect(prompt).toContain("Criterion C must pass");
          },
          output: { stdout: "<promise>COMPLETE</promise>" }
        }]
      });

      await sim.run();
    });

    it("prompt includes story description", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [{
            id: "US-001",
            title: "Feature",
            description: "As a user, I want to be able to login so that I can access my account."
          }]
        },
        turns: [{
          assertPrompt: (prompt) => {
            expect(prompt).toContain("As a user, I want to be able to login");
          },
          output: { stdout: "<promise>COMPLETE</promise>" }
        }]
      });

      await sim.run();
    });

    it("prompt includes quality gates", async () => {
      const sim = createRalphSimulation({
        plan: {
          qualityGates: ["npm test", "npm run lint", "npm run build"],
          stories: [{ id: "US-001", title: "Feature" }]
        },
        turns: [{
          assertPrompt: (prompt) => {
            expect(prompt).toContain("npm test");
            expect(prompt).toContain("npm run lint");
            expect(prompt).toContain("npm run build");
          },
          output: { stdout: "<promise>COMPLETE</promise>" }
        }]
      });

      await sim.run();
    });

    it("prompt includes dependency information", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "Base" },
            { id: "US-002", title: "Depends", dependsOn: ["US-001"] }
          ]
        },
        turns: [
          completeTurn(),
          {
            assertPrompt: (prompt) => {
              expect(prompt).toContain("Depends on: US-001");
            },
            output: { stdout: "<promise>COMPLETE</promise>" }
          }
        ]
      });

      await sim.run();
    });
  });

  describe("edge case bugs", () => {
    it("handles circular dependencies gracefully", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "First", dependsOn: ["US-002"] },
            { id: "US-002", title: "Second", dependsOn: ["US-001"] }
          ]
        },
        config: { maxIterations: 1 },
        turns: []
      });

      const { result } = await sim.run();

      // With circular deps, no story can be selected
      expect(result.stopReason).toBe("no_actionable_stories");
      expect(result.iterationsCompleted).toBe(0);
    });

    it("handles missing dependency (story blocked forever)", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "Depends on non-existent", dependsOn: ["US-999"] }
          ]
        },
        config: { maxIterations: 1 },
        turns: []
      });

      const { result } = await sim.run();

      // Story can never be selected because US-999 doesn't exist
      expect(result.stopReason).toBe("no_actionable_stories");
      expect(result.iterationsCompleted).toBe(0);
    });

    it("handles self-referencing dependency", async () => {
      const sim = createRalphSimulation({
        plan: {
          stories: [
            { id: "US-001", title: "Depends on itself", dependsOn: ["US-001"] }
          ]
        },
        config: { maxIterations: 1 },
        turns: []
      });

      const { result } = await sim.run();

      // Story depends on itself which isn't "done", so blocked
      expect(result.stopReason).toBe("no_actionable_stories");
      expect(result.iterationsCompleted).toBe(0);
    });
  });
});
