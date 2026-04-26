import type {
  ApprovalRequest,
  ApprovalResult,
  HumanInLoopProvider,
} from "./types.js";

export function requestApproval(
  args: ApprovalRequest & { provider: HumanInLoopProvider },
): Promise<ApprovalResult> {
  const { provider, ...request } = args;
  return provider.requestApproval(request);
}
