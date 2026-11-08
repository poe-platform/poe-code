import { validateMachine } from "@poe-code/task-list";
import { describe, expect, it } from "vitest";
import { approvalStateMachine } from "./index.js";

describe("approvalStateMachine", () => {
  it("passes state-machine validation", () => {
    expect(() => validateMachine(approvalStateMachine)).not.toThrow();
  });

  it("declares the documented transitions", () => {
    expect(approvalStateMachine.events).toEqual({
      claim: { from: ["pending"], to: "prompting" },
      start: { from: ["prompting"], to: "approved-running" },
      succeed: { from: ["approved-running"], to: "approved-done" },
      fail: { from: ["prompting", "approved-running"], to: "approved-failed" },
      decline: { from: ["pending", "prompting"], to: "declined" },
    });
  });

  it("cannot be mutated through the public export", () => {
    expect(() => {
      approvalStateMachine.events.start.to = "approved-done";
    }).toThrow();
    expect(() => {
      approvalStateMachine.events.start.from.push("approved-done");
    }).toThrow();

    expect(approvalStateMachine.events.start).toEqual({
      from: ["prompting"],
      to: "approved-running",
    });
  });
});
