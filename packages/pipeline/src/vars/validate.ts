import { buildExecutionPrompt } from "../run/runner.js";
import type { PipelinePlan, ResolvedStepDefinitions, StepDefinition } from "../types.js";
import { interpolatePipelineVars } from "./interpolate.js";

function validatePhasePrompt(
  phase: "setup" | "teardown",
  definition: StepDefinition | undefined,
  vars: Record<string, string>
): void {
  if (!definition) {
    return;
  }

  interpolatePipelineVars(definition.prompt, vars, phase);
}

export function validateResolvedPromptVars(input: {
  plan: PipelinePlan;
  steps: ResolvedStepDefinitions;
  planPath: string;
  vars?: Record<string, string>;
  setup?: StepDefinition;
  teardown?: StepDefinition;
}): void {
  const vars = input.vars ?? {};

  validatePhasePrompt("setup", input.setup, vars);

  for (const task of input.plan.tasks) {
    if (typeof task.status === "string") {
      buildExecutionPrompt({
        selection: { kind: "run", task },
        steps: input.steps,
        planPath: input.planPath,
        vars
      });
      continue;
    }

    for (const stepName of Object.keys(task.status)) {
      buildExecutionPrompt({
        selection: { kind: "run", task, stepName },
        steps: input.steps,
        planPath: input.planPath,
        vars
      });
    }
  }

  validatePhasePrompt("teardown", input.teardown, vars);
}
