import type { ApprovalResult, HumanInLoopProvider } from "../types.js";

export function mockProvider(
  answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>),
): HumanInLoopProvider {
  return {
    id: "mock",
    async requestApproval(_request) {
      if (typeof answer === "function") {
        return await answer();
      }

      return answer;
    },
  };
}
