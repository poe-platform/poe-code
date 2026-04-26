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
});
