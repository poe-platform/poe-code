import { describe, it, expect, vi } from "vitest";
import { runChecks } from "./run.js";
import type { DoctorCheck, DoctorContext, CheckResult } from "./types.js";

function createCheck(
  id: string,
  result: CheckResult,
  category = "test"
): DoctorCheck {
  return {
    id,
    category,
    description: `Check ${id}`,
    run: vi.fn(async () => result)
  };
}

const stubContext = { previousResults: new Map() } as DoctorContext;

describe("runChecks", () => {
  it("runs all checks and returns results", async () => {
    const checks = [
      createCheck("a", { status: "pass", message: "ok" }),
      createCheck("b", { status: "fail", message: "bad" })
    ];
    const result = await runChecks(checks, stubContext);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0].result.status).toBe("pass");
    expect(result.checks[1].result.status).toBe("fail");
  });

  it("computes summary correctly", async () => {
    const checks = [
      createCheck("a", { status: "pass", message: "ok" }),
      createCheck("b", { status: "warn", message: "warn" }),
      createCheck("c", { status: "fail", message: "bad" }),
      createCheck("d", { status: "skip", message: "skipped" })
    ];
    const result = await runChecks(checks, stubContext);
    expect(result.summary).toEqual({
      pass: 1,
      warn: 1,
      fail: 1,
      skip: 1
    });
  });

  it("populates previousResults for dependency skipping", async () => {
    const dependentCheck: DoctorCheck = {
      id: "b",
      category: "test",
      description: "Check b",
      run: vi.fn(async (ctx: DoctorContext) => {
        const prev = ctx.previousResults.get("a");
        if (prev?.status === "fail") {
          return { status: "skip", message: "skipped due to a" };
        }
        return { status: "pass", message: "ok" };
      })
    };

    const checks = [
      createCheck("a", { status: "fail", message: "failed" }),
      dependentCheck
    ];
    const result = await runChecks(checks, stubContext);
    expect(result.checks[1].result.status).toBe("skip");
  });

  it("runs checks sequentially in order", async () => {
    const order: string[] = [];
    const makeSequentialCheck = (id: string): DoctorCheck => ({
      id,
      category: "test",
      description: `Check ${id}`,
      async run() {
        order.push(id);
        return { status: "pass", message: "ok" };
      }
    });
    const checks = [
      makeSequentialCheck("first"),
      makeSequentialCheck("second"),
      makeSequentialCheck("third")
    ];
    await runChecks(checks, stubContext);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("returns empty result for no checks", async () => {
    const result = await runChecks([], stubContext);
    expect(result.checks).toHaveLength(0);
    expect(result.summary).toEqual({ pass: 0, warn: 0, fail: 0, skip: 0 });
  });
});
