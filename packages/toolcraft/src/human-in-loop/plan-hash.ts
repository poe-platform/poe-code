import { createHash } from "node:crypto";
import { UserError } from "../user-error.js";

export type ApprovalPlanValue =
  | null
  | boolean
  | number
  | string
  | ApprovalPlanValue[]
  | { [key: string]: ApprovalPlanValue };

export interface ApprovalPlan {
  value: ApprovalPlanValue;
  canonical: string;
  display: string;
  hash: string;
}

export function isApprovalPlanValue(value: unknown): value is ApprovalPlanValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isApprovalPlanValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(isApprovalPlanValue)
  );
}

function normalizePlan(value: unknown, seen: Set<object>): ApprovalPlanValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UserError("Approval plan numbers must be finite.");
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new UserError("Approval plan must contain only JSON values.");
  }

  if (seen.has(value)) {
    throw new UserError("Approval plan must not contain circular references.");
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizePlan(item, seen));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new UserError("Approval plan must contain only JSON values.");
    }

    const normalized: Record<string, ApprovalPlanValue> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizePlan((value as Record<string, unknown>)[key], seen);
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

export function createApprovalPlan(value: unknown): ApprovalPlan {
  const normalized = normalizePlan(value, new Set());
  const canonical = JSON.stringify(normalized);
  const digest = createHash("sha256").update(canonical).digest("hex");

  return {
    value: normalized,
    canonical,
    display: JSON.stringify(normalized, null, 2),
    hash: `sha256:${digest}`
  };
}

export function formatApprovalMessage(message: string, plan: ApprovalPlan): string {
  return `${message}\n\nPlan:\n${plan.display}\n\nPlan hash: ${plan.hash}`;
}

export function assertApprovalPlanHash(expectedHash: string, actualHash: string): void {
  if (expectedHash !== actualHash) {
    throw new UserError(
      `Approval plan changed after approval. Expected ${expectedHash}, received ${actualHash}.`
    );
  }
}
