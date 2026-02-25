import { renderTemplate } from "@poe-code/config-mutations";

export type PromptVariableName =
  | "PLAN_PATH"
  | "PROGRESS_PATH"
  | "REPO_ROOT"
  | "REQUEST"
  | "OUT_PATH"
  | "GUARDRAILS_PATH"
  | "ERRORS_LOG_PATH"
  | "ACTIVITY_LOG_PATH"
  | "GUARDRAILS_REF"
  | "CONTEXT_REF"
  | "ACTIVITY_CMD"
  | "COMMIT"
  | "RUN_ID"
  | "ITERATION"
  | "RUN_LOG_PATH"
  | "RUN_META_PATH"
  | "STORY_ID"
  | "STORY_TITLE"
  | "STORY_BLOCK"
  | "QUALITY_GATES";

export type PromptVariableValue = string | number | boolean | string[];

export type PromptVariables = Partial<Record<PromptVariableName, PromptVariableValue>>;

export function renderPrompt(template: string, variables: PromptVariables): string {
  return renderTemplate(template, variables as Record<string, PromptVariableValue>);
}
