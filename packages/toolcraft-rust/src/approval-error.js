import { UserError } from "./index.js";

export class ApprovalDeclinedError extends UserError {
  constructor(options) {
    super(options.reason === undefined ? "Declined." : `Declined: ${options.reason}`);
    this.name = "ApprovalDeclinedError";
    this.reason = options.reason;
    this.approvalId = options.approvalId;
    this.commandPath = options.commandPath;
  }
}
