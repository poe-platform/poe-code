import type { PlanReadiness } from "./plans.js";

export function formatPlanReadinessLabel(label: string, readiness: PlanReadiness): string {
  return `${label}${readiness === "ready" ? " ✓" : ""}`;
}

export function comparePlanReadiness(
  left: { readiness: PlanReadiness },
  right: { readiness: PlanReadiness }
): number {
  return Number(right.readiness === "ready") - Number(left.readiness === "ready");
}
