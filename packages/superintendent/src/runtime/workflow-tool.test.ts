import { describe, expect, it } from "vitest";
import {
  createWorkflowTool,
  parseWorkflowCall,
  workflowTransitionOutputSchema
} from "./workflow-tool.js";

describe("createWorkflowTool", () => {
  it("gives superintendent in in_progress only request_review", () => {
    const tool = createWorkflowTool("superintendent", "in_progress");

    expect(tool).toEqual({
      name: "workflow_transition",
      description: "Transition the workflow state. Valid actions: request_review.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action", "summary"],
        properties: {
          action: {
            type: "string",
            description: "Workflow transition action to apply.",
            enum: ["request_review"]
          },
          summary: {
            type: "string",
            description: "Summarize why the work is ready for owner review."
          }
        }
      },
      outputSchema: workflowTransitionOutputSchema
    });
  });

  it("gives owner in review approve_completion and request_changes", () => {
    const tool = createWorkflowTool("owner", "review");

    expect(tool).toEqual({
      name: "workflow_transition",
      description: "Transition the workflow state. Valid actions: approve_completion, request_changes.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: {
            type: "string",
            description: "Workflow transition action to apply.",
            enum: ["approve_completion", "request_changes"]
          },
          feedback: {
            type: "string",
            description: "Required when action is request_changes. Explain what needs to change."
          }
        }
      },
      outputSchema: workflowTransitionOutputSchema
    });
  });

  it("gives superintendent in review only request_review", () => {
    const tool = createWorkflowTool("superintendent", "review");

    expect(tool).toEqual({
      name: "workflow_transition",
      description: "Transition the workflow state. Valid actions: request_review.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action", "summary"],
        properties: {
          action: {
            type: "string",
            description: "Workflow transition action to apply.",
            enum: ["request_review"]
          },
          summary: {
            type: "string",
            description: "Summarize why the work is ready for owner review."
          }
        }
      },
      outputSchema: workflowTransitionOutputSchema
    });
  });
});

describe("parseWorkflowCall", () => {
  it("validates the action field", () => {
    expect(() => parseWorkflowCall({ action: "not-real" })).toThrow(
      'workflow_transition action must be one of "request_review", "approve_completion", or "request_changes"'
    );
    expect(() => parseWorkflowCall({})).toThrow(
      'workflow_transition action must be one of "request_review", "approve_completion", or "request_changes"'
    );
    expect(() => parseWorkflowCall([])).toThrow(
      'workflow_transition action must be one of "request_review", "approve_completion", or "request_changes"'
    );
  });

  it("requires summary for request_review", () => {
    expect(() => parseWorkflowCall({ action: "request_review" })).toThrow(
      'workflow_transition summary must be a non-empty string for "request_review"'
    );
    expect(() => parseWorkflowCall({ action: "request_review", summary: "   " })).toThrow(
      'workflow_transition summary must be a non-empty string for "request_review"'
    );

    expect(parseWorkflowCall({ action: "request_review", summary: "Ready for owner review" })).toEqual({
      action: "request_review",
      summary: "Ready for owner review"
    });
  });

  it("parses approve_completion without additional payload", () => {
    expect(parseWorkflowCall({ action: "approve_completion" })).toEqual({
      action: "approve_completion"
    });
  });

  it("requires feedback for request_changes", () => {
    expect(() => parseWorkflowCall({ action: "request_changes" })).toThrow(
      'workflow_transition feedback must be a non-empty string for "request_changes"'
    );
    expect(() => parseWorkflowCall({ action: "request_changes", feedback: "   " })).toThrow(
      'workflow_transition feedback must be a non-empty string for "request_changes"'
    );

    expect(parseWorkflowCall({ action: "request_changes", feedback: "Add one more test" })).toEqual({
      action: "request_changes",
      feedback: "Add one more test"
    });
  });
});
