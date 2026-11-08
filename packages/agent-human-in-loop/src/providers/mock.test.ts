import { describe, expect, it } from "vitest";

import { mockProvider } from "../index.js";

describe("mockProvider", () => {
  it("returns the same value on consecutive calls when given a value", async () => {
    const provider = mockProvider({ outcome: "approved" });

    expect(provider.id).toBe("mock");
    await expect(
      provider.requestApproval({ message: "first" }),
    ).resolves.toEqual({ outcome: "approved" });
    await expect(
      provider.requestApproval({ message: "second" }),
    ).resolves.toEqual({ outcome: "approved" });
  });

  it("returns a fresh copy of a fixed answer on every call", async () => {
    const fixed = { outcome: "declined", reason: "initial" } as const;
    const provider = mockProvider(fixed);

    const first = await provider.requestApproval({ message: "first" });
    (first as { reason: string; extra?: string }).reason = "mutated";
    (first as { extra?: string }).extra = "leaked";

    expect(fixed).toEqual({ outcome: "declined", reason: "initial" });
    await expect(
      provider.requestApproval({ message: "second" }),
    ).resolves.toEqual({ outcome: "declined", reason: "initial" });
  });

  it("invokes a thunk once per call and advances through a scripted sequence", async () => {
    const scriptedAnswers = [
      { outcome: "declined", reason: "x-1" },
      { outcome: "declined", reason: "x-2" },
      { outcome: "declined", reason: "x-3" },
    ] as const;
    let index = 0;

    const provider = mockProvider(() => {
      const answer = scriptedAnswers[index];
      index += 1;
      return answer;
    });

    await expect(
      provider.requestApproval({ message: "first" }),
    ).resolves.toEqual({ outcome: "declined", reason: "x-1" });
    await expect(
      provider.requestApproval({ message: "second" }),
    ).resolves.toEqual({ outcome: "declined", reason: "x-2" });
    await expect(
      provider.requestApproval({ message: "third" }),
    ).resolves.toEqual({ outcome: "declined", reason: "x-3" });
    expect(index).toBe(3);
  });

  it("awaits an async thunk result", async () => {
    const provider = mockProvider(() =>
      Promise.resolve({ outcome: "approved" } as const),
    );

    await expect(provider.requestApproval({ message: "async" })).resolves.toEqual(
      { outcome: "approved" },
    );
  });
});
