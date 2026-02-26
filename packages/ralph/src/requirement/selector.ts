import type { Plan, Requirement } from "../plan/types.js";

export type SelectRequirementOptions = {
  ignoreIds?: ReadonlySet<string>;
};

export function selectRequirement(plan: Plan, options: SelectRequirementOptions = {}): Requirement | null {
  const ignoreIds = options.ignoreIds ?? null;
  return plan.requirements.find((r) => r.status !== "passed" && (!ignoreIds || !ignoreIds.has(r.id))) ?? null;
}
