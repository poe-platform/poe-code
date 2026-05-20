import type { Task } from "@poe-code/task-list";
import { describe, expect, it } from "vitest";

import { renderPromptTemplate, renderStepPrompt, renderTaskPrompt } from "./render.js";

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

  it("renders task.url from metadata.url", () => {
    expect(
      renderTaskPrompt("Issue: {{ task.url }}", {
        task: {
          ...task,
          metadata: { url: "https://github.com/org/repo/issues/123" }
        },
        attempt: 1
      })
    ).toBe("Issue: https://github.com/org/repo/issues/123");
  });

  it("renders task.url as empty when metadata.url is missing", () => {
    expect(
      renderTaskPrompt("Issue: {{ task.url }}", {
        task: {
          ...task,
          metadata: { source: "markdown-dir" }
        },
        attempt: 1
      })
    ).toBe("Issue: ");
  });

  it("renders task.url as empty when metadata.url is not a string", () => {
    expect(
      renderTaskPrompt("Issue: {{ task.url }}", {
        task: {
          ...task,
          metadata: { url: 123 }
        },
        attempt: 1
      })
    ).toBe("Issue: ");
  });

  it("renders task.metadata as JSON", () => {
    expect(
      renderTaskPrompt("Metadata: {{ task.metadata }}", {
        task: {
          ...task,
          metadata: {
            url: "https://github.com/org/repo/issues/123",
            nested: { owner: "org", number: 123 }
          }
        },
        attempt: 1
      })
    ).toBe(
      'Metadata: {"url":"https://github.com/org/repo/issues/123","nested":{"owner":"org","number":123}}'
    );
  });

  it("falls back to the documented task prompt when the template is empty", () => {
    expect(renderTaskPrompt("", { task, attempt: 1 })).toBe(
      "backlog/ship-render: Ship prompt renderer\n\nRender task and step prompts."
    );
  });

  it("renders step prompts with the rendered task prompt", () => {
    const step = {
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

  it("renders state prompt templates with the rendered task prompt", () => {
    expect(
      renderPromptTemplate("State sees {{ prompt }}", {
        prompt: "Rendered task body",
        task,
        attempt: 3
      })
    ).toBe("State sees Rendered task body");
  });

  it("throws on unknown variables", () => {
    expect(() => renderTaskPrompt("{{ missing }}", { task, attempt: 1 })).toThrow(
      'Missing pipeline variable "missing"'
    );
  });
});
