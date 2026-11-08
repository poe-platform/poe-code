export type PlanKind = "plan" | "pipeline" | "superintendent" | "experiment";

export type DispatchSpec =
  | { kind: "agent"; agent: string; prompt: string }
  | {
      kind: "pipeline" | "superintendent" | "experiment";
      agent: string;
      model: string;
      planPath: string;
    };

export class UnsupportedPlanKindError extends Error {
  constructor(planKind: unknown) {
    super(`Unsupported plan kind: ${String(planKind)}`);
    this.name = "UnsupportedPlanKindError";
  }
}

export function resolveDispatch(input: {
  planKind: PlanKind;
  planBody: string;
  planPath: string;
  agent: string;
  model: string;
}): DispatchSpec {
  switch (input.planKind) {
    case "plan":
      return {
        kind: "agent",
        agent: input.agent,
        prompt: input.planBody
      };
    case "pipeline":
      return {
        kind: "pipeline",
        agent: input.agent,
        model: input.model,
        planPath: input.planPath
      };
    case "superintendent":
      return {
        kind: "superintendent",
        agent: input.agent,
        model: input.model,
        planPath: input.planPath
      };
    case "experiment":
      return {
        kind: "experiment",
        agent: input.agent,
        model: input.model,
        planPath: input.planPath
      };
    default:
      throw new UnsupportedPlanKindError(input.planKind);
  }
}
