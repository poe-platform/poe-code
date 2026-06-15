import type { ApprovalResult, HumanInLoopProvider } from "../types.js";

export function mockProvider(
  answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>),
): HumanInLoopProvider {
  return {
    id: "mock",
    async requestApproval(_request) {
      if (typeof answer === "function") {
        return cloneApprovalResult(await answer());
      }

      return cloneApprovalResult(answer);
    },
  };
}

function cloneApprovalResult(result: ApprovalResult): ApprovalResult {
  return result.outcome === "approved"
    ? { outcome: "approved" }
    : result.reason === undefined
      ? { outcome: "declined" }
      : { outcome: "declined", reason: result.reason };
}
