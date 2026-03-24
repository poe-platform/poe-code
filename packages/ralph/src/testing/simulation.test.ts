import { describe, expect, it, vi } from "vitest";
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

  it("stops when overbaking is aborted", async () => {
    const promptOverbake = vi.fn().mockResolvedValue("abort");

    const sim = createRalphSimulation({
      docContent: "Keep trying",
      maxIterations: 4,
      maxFailures: 2,
      promptOverbake,
      turns: [failTurn("first"), failTurn("second"), successTurn()]
    });

    const { result, runs } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "overbake_abort",
      iterationsCompleted: 2
    });
    expect(runs).toHaveLength(2);
    expect(promptOverbake).toHaveBeenCalledWith({
      consecutiveFailures: 2,
      threshold: 2
    });
  });

  it("continues after an overbake warning when the user allows it", async () => {
    const promptOverbake = vi.fn().mockResolvedValue("continue");

    const sim = createRalphSimulation({
      docContent: "Recover after failures",
      maxIterations: 3,
      maxFailures: 2,
      promptOverbake,
      turns: [failTurn("first"), failTurn("second"), successTurn()]
    });

    const { result } = await sim.run();

    expect(result).toMatchObject({
      stopReason: "max_iterations",
      iterationsCompleted: 3
    });
    expect(promptOverbake).toHaveBeenCalledTimes(1);
  });

  it("writes frontmatter with in_progress status on start", async () => {
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
    expect(data.status).toBe("in_progress");
    expect(data.iteration).toBe(0);
  });

  it("updates frontmatter iteration count after each iteration", async () => {
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
            iterationAfterFirst = data.iteration;
          },
          output: { stdout: "", exitCode: 0 }
        }
      ]
    });

    await sim.run();

    expect(iterationAfterFirst).toBe(1);
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
    expect(data.status).toBe("completed");
    expect(data.iteration).toBe(2);
    expect(body).toBe("# Archive me");
  });

  it("does not archive on overbake abort", async () => {
    const sim = createRalphSimulation({
      docContent: "# Keep me",
      maxIterations: 4,
      maxFailures: 2,
      promptOverbake: async () => "abort",
      turns: [failTurn("err1"), failTurn("err2")]
    });

    const { readFile } = await sim.run();

    const content = await readFile(".poe-code/ralph/plans/plan.md");
    const { data } = parseFrontmatter(content);
    expect(data.status).toBe("overbake_abort");
    expect(data.iteration).toBe(2);
  });

  it("writes cancelled status on abort signal", async () => {
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
    expect(data.status).toBe("cancelled");
  });

  it("strips frontmatter from prompt sent to agent", async () => {
    const sim = createRalphSimulation({
      docContent: "---\nstatus: pending\niteration: 0\n---\n# Real content",
      maxIterations: 1,
      turns: [successTurn()]
    });

    const { prompts } = await sim.run();

    expect(prompts).toEqual(["# Real content"]);
  });
});
