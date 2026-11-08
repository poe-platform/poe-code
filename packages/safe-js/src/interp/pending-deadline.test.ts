import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";

it("enforces the earliest pending deadline across realm views and releases each lease independently", () => {
  const root = new Budget();
  const view = root.forkRealm();
  const early = vi.fn();
  const late = vi.fn();
  const releaseEarly = root.acquireDeadline(100, early);
  const releaseLate = view.acquireDeadline(200, late);
  const clock = vi.spyOn(Date, "now").mockReturnValue(150);
  try {
    expect(() => view.visitNode(1024)).toThrowError(
      expect.objectContaining({ budget: "deadline", limit: 100 })
    );
    expect(early).toHaveBeenCalledTimes(1);
    expect(() => root.visitNode(1024)).toThrow();
    expect(early).toHaveBeenCalledTimes(1);
    releaseEarly();
    releaseEarly();
    expect(() => root.visitNode(1024)).not.toThrow();
    clock.mockReturnValue(201);
    expect(() => root.visitNode(1024)).toThrowError(
      expect.objectContaining({ budget: "deadline", limit: 200 })
    );
    expect(late).toHaveBeenCalledTimes(1);
    releaseLate();
    expect(() => view.visitNode(1024)).not.toThrow();
  } finally {
    releaseEarly();
    releaseLate();
    clock.mockRestore();
  }
});

it("keeps an equal sibling deadline after releasing one lease and survives usage reset", () => {
  const budget = new Budget();
  const first = vi.fn(),
    second = vi.fn();
  const releaseFirst = budget.acquireDeadline(100, first);
  const releaseSecond = budget.acquireDeadline(100, second);
  const clock = vi.spyOn(Date, "now").mockReturnValue(101);
  try {
    releaseFirst();
    budget.reset();
    expect(() => budget.visitNode(1024)).toThrowError(
      expect.objectContaining({ budget: "deadline", limit: 100 })
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    releaseSecond();
    expect(() => budget.visitNode(1024)).not.toThrow();
  } finally {
    releaseFirst();
    releaseSecond();
    clock.mockRestore();
  }
});

it("preserves an earlier caller deadline without notifying a later import", () => {
  const budget = new Budget({ deadline: 100 });
  const abort = vi.fn();
  const release = budget.acquireDeadline(200, abort);
  const clock = vi.spyOn(Date, "now").mockReturnValue(150);
  try {
    expect(() => budget.visitNode(1024)).toThrowError(
      expect.objectContaining({ budget: "deadline", limit: 100 })
    );
    expect(abort).not.toHaveBeenCalled();
    release();
    expect(() => budget.visitNode(1024)).toThrowError(
      expect.objectContaining({ budget: "deadline", limit: 100 })
    );
  } finally {
    release();
    clock.mockRestore();
  }
});

it.each([NaN, Infinity, -Infinity, undefined])(
  "rejects invalid deadline %s without leaving a guard",
  (deadline) => {
    const budget = new Budget();
    expect(() => budget.acquireDeadline(deadline as number)).toThrow(TypeError);
    expect(() => budget.visitNode(1024)).not.toThrow();
  }
);
