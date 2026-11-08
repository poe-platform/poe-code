import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import type { Budget } from "../budget.js";
import { createSandboxTemporalDuration, temporalDurationFieldNames } from "../temporal-duration.js";
import type { SandboxCallContext, SandboxValue } from "../values.js";
import { readTemporalDifferenceOptions } from "./temporal-difference-options.js";

export async function differenceTemporalInstant(
  operation: "until" | "since", epoch: bigint, other: bigint,
  options: SandboxValue, budget: Budget, context?: SandboxCallContext
) {
  const normalized = await readTemporalDifferenceOptions(options, budget, context);
  const difference = new TemporalBackend.Instant(epoch)[operation](new TemporalBackend.Instant(other), normalized);
  return createSandboxTemporalDuration(Object.fromEntries(temporalDurationFieldNames.map(name => [name, difference[name]])));
}
