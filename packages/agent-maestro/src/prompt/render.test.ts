import type { StepDefinition } from "@poe-code/pipeline";
import type { Task } from "@poe-code/task-list";
import { describe, expect, it } from "vitest";

import { renderStepPrompt, renderTaskPrompt } from "./render.js";

const task: Task = {
  list: "backlog",
  id: "ship-render",
  qualifiedId: "backlog/ship-render",
  name: "Ship prompt renderer",
  state: "planned",
  description: "Render task and step prompts.",
  metadata: {}
};

describe("prompt renderers", () => {
  it("renders task fields and attempt values", () => {
    expect(
      renderTaskPrompt("Work on {{ task.qualifiedId }} named {{ task.name }} attempt {{ attempt }}.", {
        task,
        attempt: 2
      })
    ).toBe("Work on backlog/ship-render named Ship prompt renderer attempt 2.");
  });

  it("falls back to the documented task prompt when the template is empty", () => {
    expect(renderTaskPrompt("", { task, attempt: 1 })).toBe(
      "backlog/ship-render: Ship prompt renderer\n\nRender task and step prompts."
    );
  });

  it("renders step prompts with the rendered task prompt", () => {
    const step: StepDefinition = {
      mode: "yolo",
      prompt: "Task:\n{{ prompt }}\n\nAttempt {{ attempt }} for {{ task.id }}."
    };

    expect(
      renderStepPrompt(step, {
        prompt: "Rendered task body",
        task,
        attempt: 3
      })
    ).toBe("Task:\nRendered task body\n\nAttempt 3 for ship-render.");
  });

  it("throws on unknown variables", () => {
    expect(() => renderTaskPrompt("{{ missing }}", { task, attempt: 1 })).toThrow(
      'Missing pipeline variable "missing"'
    );
  });
});
