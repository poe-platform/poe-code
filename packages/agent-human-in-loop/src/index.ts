export type {
  ApprovalRequest,
  ApprovalResult,
  HumanInLoopProvider,
} from "./types.js";
export { requestApproval } from "./request-approval.js";
export { osascriptProvider } from "./providers/osascript.js";
export type { OsascriptProviderOptions } from "./providers/osascript.js";
export { mockProvider } from "./providers/mock.js";
