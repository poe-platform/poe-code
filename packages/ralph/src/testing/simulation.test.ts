import { describe, expect, it, vi } from "vitest";
import {
  createRalphSimulation,
  failTurn,
  successTurn
} from "./simulation.js";

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
          ".poe-code/ralph/plans/plan.md": "Version two"
        }),
        successTurn()
      ]
    });

    const { prompts, readFile } = await sim.run();

    expect(prompts).toEqual(["Version one", "Version one"]);
    await expect(readFile(".poe-code/ralph/plans/plan.md")).resolves.toBe(
      "Version two"
    );
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
});
