export interface ApprovalRequest {
  message: string;
  declineInputPrompt?: string;
}

export type ApprovalResult =
  | { outcome: "approved" }
  | { outcome: "declined"; reason?: string };

export interface HumanInLoopProvider {
  readonly id: string;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
}
