import type {
  ApprovalRequest,
  ApprovalResult,
  HumanInLoopProvider,
} from "./types.js";

export async function requestApproval(
  args: ApprovalRequest & { provider: HumanInLoopProvider },
): Promise<ApprovalResult> {
  const { provider, ...request } = args;
  return normalizeApprovalResult(
    await provider.requestApproval(normalizeApprovalRequest(request)),
  );
}

function normalizeApprovalRequest(request: ApprovalRequest): ApprovalRequest {
  if (typeof request.message !== "string" || request.message.trim().length === 0) {
    throw new Error("Approval request message must not be blank");
  }

  if (
    request.declineInputPrompt !== undefined &&
    typeof request.declineInputPrompt !== "string"
  ) {
    throw new Error("Approval request declineInputPrompt must be a string");
  }

  return request.declineInputPrompt === undefined
    ? { message: request.message }
    : {
        message: request.message,
        declineInputPrompt: request.declineInputPrompt,
      };
}

function normalizeApprovalResult(result: unknown): ApprovalResult {
  if (!isObjectRecord(result)) {
    throw new Error("Approval provider returned an invalid result");
  }

  const outcome = getOwnEntry(result, "outcome");
  if (outcome === "approved") {
    return { outcome: "approved" };
  }

  if (outcome === "declined") {
    const reason = getOwnEntry(result, "reason");
    if (reason === undefined) {
      return { outcome: "declined" };
    }

    if (typeof reason === "string") {
      return { outcome: "declined", reason };
    }
  }

  throw new Error("Approval provider returned an invalid result");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
