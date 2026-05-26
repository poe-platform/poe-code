# Maestro TUI open issue accepts http-prefixed custom URL schemes

## Summary

The Maestro TUI exposes an “Open issue in browser” action for tasks whose `metadata.url` begins with the four characters `http`. That prefix check accepts arbitrary URL schemes such as `httpx:`, and the action passes them directly to the operating-system URL launcher. Markdown-backed tasks can therefore cause the UI to offer and launch a non-HTTP custom protocol as if it were an issue web link.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/maestro-tui/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@poe-code/task-list";

const { openExternalMock } = vi.hoisted(() => ({ openExternalMock: vi.fn(async () => {}) }));
vi.mock("@poe-code/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/design-system")>()),
  openExternal: openExternalMock
}));

import { buildOpenIssueAction } from "./actions.js";

describe("maestro issue url scheme validation", () => {
  it("opens metadata URLs with an arbitrary http-prefixed scheme", async () => {
    const task: Task = {
      list: "tasks",
      id: "unsafe",
      qualifiedId: "tasks/unsafe",
      name: "unsafe",
      state: "planned",
      description: "",
      metadata: { url: "httpx:run-untrusted-handler" }
    };
    const action = buildOpenIssueAction({ taskByRowId: () => new Map([["tasks/unsafe", task]]) });
    const ctx = {
      row: { id: "tasks/unsafe" },
      suspendAnd: async (run: () => Promise<void>) => run(),
      toast: vi.fn()
    } as never;

    console.log(JSON.stringify({ allowed: action.predicate?.(ctx), url: task.metadata.url }));
    expect(action.predicate?.(ctx)).toBe(true);
    await action.handler(ctx);
    expect(openExternalMock).toHaveBeenCalledWith("httpx:run-untrusted-handler");
  });
});
PROBE
npm exec -- vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
rm packages/maestro-tui/src/__probe__.test.ts
```

Output:

```text
{"allowed":true,"url":"httpx:run-untrusted-handler"}
✓ packages/maestro-tui/src/__probe__.test.ts > maestro issue url scheme validation > opens metadata URLs with an arbitrary http-prefixed scheme
```

## Observed Behavior

`getIssueUrl()` accepts any string satisfying `url.startsWith("http")` at `packages/maestro-tui/src/actions.ts:133` through `packages/maestro-tui/src/actions.ts:136`. The action predicate consequently exposes the “Open issue in browser” command, and its handler forwards the accepted value to `openExternal()` at `packages/maestro-tui/src/actions.ts:111` through `packages/maestro-tui/src/actions.ts:130`. `openExternal()` parses the value as a URL and invokes the platform URL opener without restricting protocols at `packages/design-system/src/components/browser.ts:21` through `packages/design-system/src/components/browser.ts:37`. Markdown task frontmatter is copied into public task metadata at `packages/task-list/src/backends/markdown-dir.ts:276` through `packages/task-list/src/backends/markdown-dir.ts:307`, so task documents can provide this value.

## Expected Behavior

An action labeled as opening an issue web link should accept only actual `http:` or `https:` URLs, or only URL origins produced by a trusted issue backend. A custom protocol beginning with `http` should not pass validation or be launched from arbitrary task metadata.

## Impact

Opening a local Markdown-backed task in the Maestro TUI can surface a deceptive browser action that launches an installed custom URL handler rather than an issue page. Repositories or task documents supplied by another party may trigger unexpected local applications or protocol-handler side effects when users invoke the apparently safe issue-link action.
