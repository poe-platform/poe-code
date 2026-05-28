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
  it("expands every documented template variable", () => {
    expect(
      renderTaskPrompt(
        [
          "id={{ task.id }}",
          "qualifiedId={{ task.qualifiedId }}",
          "url={{ task.url }}",
          "description={{ task.description }}",
          "name={{ task.name }}",
          "state={{ task.state }}",
          "metadata={{ task.metadata }}",
          "list={{ task.list }}"
        ].join("\n"),
        {
          task: {
            list: "bugs",
            id: "bug-7",
            qualifiedId: "bugs/bug-7",
            name: "Fix login",
            state: "planned",
            description: "Repair OAuth callback",
            metadata: { url: "https://tracker.local/bugs/7", priority: 1 }
          },
          attempt: 1
        }
      )
    ).toBe(
      [
        "id=bug-7",
        "qualifiedId=bugs/bug-7",
        "url=https://tracker.local/bugs/7",
        "description=Repair OAuth callback",
        "name=Fix login",
        "state=planned",
        'metadata={"priority":1,"url":"https://tracker.local/bugs/7"}',
        "list=bugs"
      ].join("\n")
    );
  });

  it("renders task fields and attempt values", () => {
    expect(
      renderTaskPrompt(
        "Work on {{ task.qualifiedId }} named {{ task.name }} attempt {{ attempt }}.",
        {
          task,
          attempt: 2
        }
      )
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
      'Metadata: {"nested":{"number":123,"owner":"org"},"url":"https://github.com/org/repo/issues/123"}'
    );
  });

  it("renders missing variables as empty strings", () => {
    expect(renderTaskPrompt("Unknown: {{ missing }}.", { task, attempt: 1 })).toBe("Unknown: .");
  });

  it("passes templates with no variables through unchanged", () => {
    expect(renderTaskPrompt("Ship the prompt renderer.", { task, attempt: 1 })).toBe(
      "Ship the prompt renderer."
    );
  });

  it("passes malformed placeholders through unchanged", () => {
    expect(renderTaskPrompt("Malformed {{ task.id", { task, attempt: 1 })).toBe(
      "Malformed {{ task.id"
    );
  });

  it("does not escape HTML or Markdown in task descriptions", () => {
    expect(
      renderTaskPrompt("Body: {{ task.description }}", {
        task: {
          ...task,
          description: "**Fix** <em>now</em>"
        },
        attempt: 1
      })
    ).toBe("Body: **Fix** <em>now</em>");
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

  it("renders missing state prompt variables as empty strings", () => {
    expect(renderPromptTemplate("State sees {{ missing }}", { prompt: "", task, attempt: 1 })).toBe(
      "State sees "
    );
  });

  it("does not serialize cyclic metadata unless the template uses it", () => {
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;

    expect(
      renderTaskPrompt("Task: {{ task.name }}", {
        task: { ...task, metadata },
        attempt: 1
      })
    ).toBe("Task: Ship prompt renderer");
  });
});
