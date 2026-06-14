import type { StatusBlock } from "../document/parse.js";

export type WorkflowTransition =
  | { action: "request_review"; summary: string }
  | { action: "approve_completion" }
  | { action: "request_changes"; feedback: string };

type McpToolProperty = {
  type: "string";
  description: string;
  enum?: Array<WorkflowTransition["action"]>;
};

type McpToolInputSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, McpToolProperty>;
  required: string[];
};

type McpToolOutputSchema = {
  type: "object";
  additionalProperties: false;
  properties: {
    recorded: {
      type: "object";
      additionalProperties: false;
      properties: {
        action: McpToolProperty;
      };
      required: ["action"];
    };
  };
  required: ["recorded"];
};

export type McpToolDefinition = {
  name: "workflow_transition";
  description: string;
  inputSchema: McpToolInputSchema;
  outputSchema: McpToolOutputSchema;
};

export const workflowTransitionOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    recorded: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          description: "Recorded workflow transition action."
        }
      },
      required: ["action"]
    }
  },
  required: ["recorded"]
} satisfies McpToolOutputSchema;

export function createWorkflowTool(
  role: "superintendent" | "owner",
  state: StatusBlock["state"]
): McpToolDefinition {
  const actions = getAllowedActions(role, state);

  return {
    name: "workflow_transition",
    description:
      actions.length === 0
        ? "Transition the workflow state. No transitions are available in the current role/state."
        : `Transition the workflow state. Valid actions: ${actions.join(", ")}.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: createProperties(actions),
      required: createRequiredFields(actions)
    },
    outputSchema: workflowTransitionOutputSchema
  };
}

export function parseWorkflowCall(input: unknown): WorkflowTransition {
  if (!isRecord(input)) {
    throw invalidActionError();
  }

  const { action } = input;

  if (action !== "request_review" && action !== "approve_completion" && action !== "request_changes") {
    throw invalidActionError();
  }

  if (action === "request_review") {
    return {
      action,
      summary: getNonEmptyString(
        input.summary,
        'workflow_transition summary must be a non-empty string for "request_review"'
      )
    };
  }

  if (action === "request_changes") {
    return {
      action,
      feedback: getNonEmptyString(
        input.feedback,
        'workflow_transition feedback must be a non-empty string for "request_changes"'
      )
    };
  }

  return { action };
}

function createProperties(actions: Array<WorkflowTransition["action"]>): Record<string, McpToolProperty> {
  const properties: Record<string, McpToolProperty> = {
    action: {
      type: "string",
      description: "Workflow transition action to apply.",
      enum: actions
    }
  };

  if (actions.includes("request_review")) {
    properties.summary = {
      type: "string",
      description: "Summarize why the work is ready for owner review."
    };
  }

  if (actions.includes("request_changes")) {
    properties.feedback = {
      type: "string",
      description: "Required when action is request_changes. Explain what needs to change."
    };
  }

  return properties;
}

function createRequiredFields(actions: Array<WorkflowTransition["action"]>): string[] {
  return actions.length === 1 && actions[0] === "request_review" ? ["action", "summary"] : ["action"];
}

function getAllowedActions(
  role: "superintendent" | "owner",
  state: StatusBlock["state"]
): Array<WorkflowTransition["action"]> {
  if (role === "superintendent" && (state === "in_progress" || state === "review")) {
    return ["request_review"];
  }

  if (role === "owner" && state === "review") {
    return ["approve_completion", "request_changes"];
  }

  return [];
}

function getNonEmptyString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorMessage);
  }

  return value;
}

function invalidActionError(): Error {
  return new Error(
    'workflow_transition action must be one of "request_review", "approve_completion", or "request_changes"'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
