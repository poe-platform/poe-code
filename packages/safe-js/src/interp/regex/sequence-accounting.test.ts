import { expect, it } from "vitest";
import { Budget } from "../budget.js";
import { matchRegex } from "./engine.js";
import { parseRegex } from "./parse.js";

it("charges literal sequence nodes and continuations without empty generator frames", () => {
  // One candidate, four sequence continuations and four literal nodes.
  const budget = new Budget({ maxSteps: 9 });
  expect(matchRegex(parseRegex("abcd"), "abcd", 0, budget)).toMatchObject({ text: "abcd" });
  expect(budget.stepsUsed).toBe(9);
});

it("still rejects before the final literal when useful sequence work exceeds the limit", () => {
  const budget = new Budget({ maxSteps: 8 });
  expect(() => matchRegex(parseRegex("abcd"), "abcd", 0, budget)).toThrow(
    expect.objectContaining({ code: "budgetExceeded", budget: "steps", current: 9, limit: 8 })
  );
  expect(budget.stepsUsed).toBe(9);
});
