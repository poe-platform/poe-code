import { describe, expect, it } from "vitest";

import { mockProvider } from "./providers/mock.js";
import { requestApproval } from "./request-approval.js";
import type { ApprovalRequest, HumanInLoopProvider } from "./types.js";

describe("requestApproval", () => {
  it("delegates to the provider and returns the result verbatim", async () => {
    await expect(
      requestApproval({
        message: "hi",
        provider: mockProvider({ outcome: "approved" }),
      }),
    ).resolves.toEqual({ outcome: "approved" });
  });

  it("passes only ApprovalRequest fields to the provider", async () => {
    let receivedRequest: ApprovalRequest | undefined;

    const provider: HumanInLoopProvider = {
      id: "spy",
      async requestApproval(request) {
        receivedRequest = request;
        return { outcome: "approved" };
      },
    };

    await requestApproval({
      message: "hi",
      declineInputPrompt: "why not?",
      provider,
    });

    expect(receivedRequest).toEqual({
      message: "hi",
      declineInputPrompt: "why not?",
    });
    expect(Object.keys(receivedRequest ?? {})).not.toContain("provider");
  });

  it("rejects blank messages before invoking the provider", async () => {
    let callCount = 0;
    const provider: HumanInLoopProvider = {
      id: "spy",
      async requestApproval() {
        callCount += 1;
        return { outcome: "approved" };
      },
    };

    await expect(
      requestApproval({ message: "   ", provider }),
    ).rejects.toThrow("Approval request message must not be blank");
    expect(callCount).toBe(0);
  });

  it("returns a fresh normalized result instead of the provider object", async () => {
    const providerResult = { outcome: "declined", reason: "later" } as const;
    const provider: HumanInLoopProvider = {
      id: "spy",
      async requestApproval() {
        return providerResult;
      },
    };

    const result = await requestApproval({ message: "hi", provider });
    expect(result).toEqual(providerResult);
    expect(result).not.toBe(providerResult);
  });

  it("rejects invalid provider results", async () => {
    const provider = {
      id: "bad",
      async requestApproval() {
        return { outcome: "maybe" };
      },
    } as unknown as HumanInLoopProvider;

    await expect(
      requestApproval({ message: "hi", provider }),
    ).rejects.toThrow("Approval provider returned an invalid result");
  });
});
