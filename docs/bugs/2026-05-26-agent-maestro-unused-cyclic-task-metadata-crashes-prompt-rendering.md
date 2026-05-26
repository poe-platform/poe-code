# Agent Maestro unused cyclic task metadata crashes prompt rendering

## Summary

The public `@poe-code/agent-maestro` `renderTaskPrompt()` API eagerly converts all task template variables, including JSON serialization of `task.metadata`, before determining which placeholders the supplied template actually uses. A task with cyclic metadata therefore crashes prompt rendering with a stack overflow even when the template references only a safe field such as `task.name`.

## Reproduction

Create the disposable probe `packages/agent-maestro/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderTaskPrompt } from "./prompt/render.js";

describe("maestro unused cyclic task metadata", () => {
  it("throws while rendering a template that only reads task name", () => {
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;
    const task = {
      id: "ship",
      qualifiedId: "tasks/ship",
      list: "tasks",
      name: "Ship",
      state: "planned",
      description: "description",
      metadata
    } as never;

    expect(() => renderTaskPrompt("Task: {{ task.name }}", { task, attempt: 1 })).toThrow(
      /Maximum call stack size exceeded/
    );
    try {
      renderTaskPrompt("Task: {{ task.name }}", { task, attempt: 1 });
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
```

Result:

```text
Maximum call stack size exceeded
✓ packages/agent-maestro/src/__probe__.test.ts > maestro unused cyclic task metadata > throws while rendering a template that only reads task name
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`renderTaskPrompt()` is publicly exported from `packages/agent-maestro/src/index.ts`. In `packages/agent-maestro/src/prompt/render.ts`, it calls `renderVars(vars)` before `interpolateVars(...)` examines the actual template. `renderVars()` always defines `"task.metadata"` using `stableJsonStringify(vars.task.metadata)`, and that helper recursively processes plain records through `sortJsonValue()` with no cycle detection. A template of `"Task: {{ task.name }}"` never requests metadata, but cyclic task metadata still recurses until `Maximum call stack size exceeded` is thrown.

## Expected Behavior

Prompt rendering should only compute variable values requested by the template, or it should safely handle non-serializable metadata values. A safe template that does not reference `task.metadata` should render `"Task: Ship"` regardless of unrelated cyclic metadata attached to the task.

## Impact

One task record containing cyclic runtime metadata can prevent Maestro from generating prompts for otherwise executable work, even when workflow templates do not use metadata. Orchestration fails with an implementation-level stack overflow rather than running the requested task or producing a focused metadata-serialization error.
