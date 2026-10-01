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
export interface OsascriptProviderOptions {
  title?: string;
  binary?: string;
}
export declare function requestApproval(args: ApprovalRequest & { provider: HumanInLoopProvider }): Promise<ApprovalResult>;
export declare function osascriptProvider(options?: OsascriptProviderOptions): HumanInLoopProvider;
export declare function mockProvider(answer: ApprovalResult | (() => ApprovalResult | Promise<ApprovalResult>)): HumanInLoopProvider;
