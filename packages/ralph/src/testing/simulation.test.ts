import { describe, expect, it } from "vitest";
import {
  createRalphSimulation,
  failTurn,
  successTurn
} from "./simulation.js";
import { parseFrontmatter } from "../frontmatter/frontmatter.js";

describe("createRalphSimulation", () => {
  it("runs the requested number of iterations with the doc prompt", async () => {
    const sim = createRalphSimulation({
      docContent: "Ship the change",
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { result, prompts, runs } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "max_iterations",
      docPath: ".poe-code/ralph/plans/plan.md",
      iterationsCompleted: 2
    });
    expect(prompts).toEqual(["Ship the change", "Ship the change"]);
    expect(runs).toEqual([
      {
        agent: "codex",
        prompt: "Ship the change",
        cwd: "/repo"
      },
      {
        agent: "codex",
        prompt: "Ship the change",
        cwd: "/repo"
      }
    ]);
  });

  it("cycles agents round-robin across iterations", async () => {
    const sim = createRalphSimulation({
      agent: ["claude-code", "codex"],
      docContent: "Keep rotating",
      maxIterations: 5,
      turns: [
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn(),
        successTurn()
      ]
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "claude-code",
      "codex",
      "claude-code"
    ]);
  });

  it("uses each agent once when iterations matches the agent list length", async () => {
    const sim = createRalphSimulation({
      agent: ["claude-code", "codex", "kimi"],
      docContent: "Keep rotating",
      maxIterations: 3,
      turns: [successTurn(), successTurn(), successTurn()]
    });

    const { runs } = await sim.run();

    expect(runs.map((run) => run.agent)).toEqual([
      "claude-code",
      "codex",
      "kimi"
    ]);
  });

  it("rejects an empty agent array", async () => {
    const sim = createRalphSimulation({
      agent: [],
      docContent: "No agent",
      maxIterations: 1,
      turns: [successTurn()]
    });

    await expect(sim.run()).rejects.toThrow(
      "agent must contain at least one entry"
    );
  });

  it("reads the markdown doc once even if it changes mid-run", async () => {
    const sim = createRalphSimulation({
      docContent: "Version one",
      maxIterations: 2,
      turns: [
        successTurn(undefined, {
          "src/index.ts": "changed"
        }),
        successTurn()
      ]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["Version one", "Version one"]);
  });

  it("writes nested frontmatter with in_progress status on start", async () => {
    let capturedContent = "";
    const sim = createRalphSimulation({
      docContent: "# Plan",
      maxIterations: 1,
      turns: [
        {
          assertPrompt: async (_prompt, ctx) => {
            capturedContent = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();

    const { data } = parseFrontmatter(capturedContent);
    expect(data.status).toEqual({
      state: "in_progress",
      iteration: 0
    });
  });

  it("updates nested frontmatter iteration count after each iteration", async () => {
    let iterationAfterFirst = -1;
    const sim = createRalphSimulation({
      docContent: "# Plan",
      maxIterations: 2,
      turns: [
        successTurn(),
        {
          assertPrompt: async (_prompt, ctx) => {
            const content = await ctx.readFile(
              ".poe-code/ralph/plans/plan.md"
            );
            const { data } = parseFrontmatter(content);
            iterationAfterFirst = data.status.iteration;
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();

    expect(iterationAfterFirst).toBe(1);
  });

  it("preserves agent and iterations config while the run updates status", async () => {
    const sim = createRalphSimulation({
      docContent: [
        "---",
        "agent:",
        "  - claude-code",
        "  - codex",
        "iterations: 5",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Plan"
      ].join("\n"),
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { readFile } = await sim.run();

    const archived = await readFile(".poe-code/ralph/plans/archive/plan.md");
    const { data } = parseFrontmatter(archived);
    expect(data).toEqual({
      agent: ["claude-code", "codex"],
      iterations: 5,
      status: {
        state: "completed",
        iteration: 2
      }
    });
  });

  it("archives plan on max_iterations completion", async () => {
    const sim = createRalphSimulation({
      docContent: "# Archive me",
      maxIterations: 2,
      turns: [successTurn(), successTurn()]
    });

    const { readFile } = await sim.run();

    const archived = await readFile(
      ".poe-code/ralph/plans/archive/plan.md"
    );
    const { data, body } = parseFrontmatter(archived);
    expect(data.status).toEqual({
      state: "completed",
      iteration: 2
    });
    expect(body).toBe("# Archive me");
  });

  it("writes open status on abort signal", async () => {
    const controller = new AbortController();
    const sim = createRalphSimulation({
      docContent: "# Cancel me",
      maxIterations: 3,
      signal: controller.signal,
      turns: [
        {
          assertPrompt: () => {
            controller.abort();
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    const { result, readFile } = await sim.run();

    expect(result.stopReason).toBe("cancelled");
    const content = await readFile(".poe-code/ralph/plans/plan.md");
    const { data } = parseFrontmatter(content);
    expect(data.status).toEqual({
      state: "open",
      iteration: 1
    });
  });

  it("strips nested frontmatter from the prompt sent to the agent", async () => {
    const sim = createRalphSimulation({
      docContent: [
        "---",
        "agent: codex",
        "iterations: 2",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Real content"
      ].join("\n"),
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["# Real content"]);
  });

  it("still strips legacy frontmatter from the prompt sent to the agent", async () => {
    const sim = createRalphSimulation({
      docContent: "---\nstatus: pending\niteration: 0\n---\n# Legacy content",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["# Legacy content"]);
  });

  it("stops on first failed iteration", async () => {
    const sim = createRalphSimulation({
      docContent: "Keep trying",
      maxIterations: 3,
      turns: [failTurn("first")]
    });

    const { result, runs } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "failed",
      iterationsCompleted: 1
    });
    expect(runs).toHaveLength(1);
  });
});
