export type PlanKind = "plan" | "pipeline" | "superintendent" | "experiment";

export interface DispatchSpec {
  /** Either an agent CLI name (kind: plan) or "node" for orchestrated kinds. */
  kind: "agent" | "node";
  /** When kind === "agent", the agent CLI id. */
  agent?: string;
  /** When kind === "node", absolute path to the JS file to run. */
  script?: string;
  /** Args appended after the script. */
  args: readonly string[];
  /** Prompt to pass when kind === "agent". */
  prompt?: string;
}

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
  poeCodeCliPath: string;
}): DispatchSpec {
  switch (input.planKind) {
    case "plan":
      return {
        kind: "agent",
        agent: input.agent,
        prompt: input.planBody,
        args: []
      };
    case "pipeline":
      return {
        kind: "node",
        script: input.poeCodeCliPath,
        args: [
          "pipeline",
          "run",
          "--plan",
          input.planPath,
          "--agent",
          input.agent,
          "--model",
          input.model
        ]
      };
    case "superintendent":
      return {
        kind: "node",
        script: input.poeCodeCliPath,
        args: [
          "superintendent",
          "run",
          input.planPath,
          "--agent",
          input.agent,
          "--model",
          input.model
        ]
      };
    case "experiment":
      return {
        kind: "node",
        script: input.poeCodeCliPath,
        args: [
          "experiment",
          "run",
          "--doc",
          input.planPath,
          "--agent",
          input.agent,
          "--model",
          input.model
        ]
      };
    default:
      throw new UnsupportedPlanKindError(input.planKind);
  }
}
