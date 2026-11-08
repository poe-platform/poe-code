import type { Budget } from "./budget.js";
import { reconcileCompiledValues, type SandboxCallContext, type SandboxValue } from "./values.js";

export function createDataCheckpoint(budget: Budget, context?: SandboxCallContext) {
  let estimatedDataSize = 0;
  return (value: SandboxValue, growth = 0, force = false): void => {
    const limit = budget.limits.dataSize;
    if (limit === undefined) return;
    estimatedDataSize = Math.max(estimatedDataSize, budget.currentDataSize) + growth;
    // Bounded growth estimates defer exact scans until they could exceed the limit.
    if (!force && estimatedDataSize <= limit) return;
    if (context?.reconcileData !== undefined) context.reconcileData(value);
    else reconcileCompiledValues(budget, [value], context?.compilation);
    estimatedDataSize = budget.currentDataSize;
  };
}
