# Config mutations template write rewrites identical rendered output

## Summary

The exported `@poe-code/config-mutations` `templateMutation.write()` operation reports a change and writes a target file even when the rendered template output is byte-for-byte identical to the existing file content.

## Environment

- Date reproduced: 2026-05-26
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: focused Vitest probe using the package in-memory filesystem helper

## Reproduction

Create a disposable probe at `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMockFs } from "./testing/index.js";
import { templateMutation } from "./mutations/template-mutation.js";
import { runMutations } from "./execution/run-mutations.js";

describe("template write idempotency probe", () => {
  it("does not rewrite or report update when rendered content is unchanged", async () => {
    const homeDir = "/home/test";
    const fs = createMockFs({ "~/.config/app.md": "same content" }, homeDir);
    const writeFile = vi.spyOn(fs, "writeFile");

    const result = await runMutations(
      [templateMutation.write({ target: "~/.config/app.md", templateId: "app.md" })],
      { fs, homeDir, templates: async () => "same content" }
    );

    expect(result.changed).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
```

Run the focused probe and remove it:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

## Observed Behavior

- The target file already contains exactly the rendered template value, `same content`.
- `runMutations(...)` returns `changed: true` for the identical template write.
- The probe fails on `expect(result.changed).toBe(false)`; the implementation also unconditionally calls `writeFile()` outside dry-run mode.

## Expected Behavior

Writing a rendered template that is identical to the persisted target should be an idempotent no-op: it should report `changed: false` and avoid rewriting the file.

## Impact

- Repeated installation and configuration flows generate spurious changes and filesystem writes even when no state differs.
- No-op runs can trigger file watchers, change timestamps, create noisy mutation reporting, and incur write-failure exposure unnecessarily.
- All consumers of `templateMutation.write()`, including bundled skill configuration, inherit this behavior.

## Supporting Evidence

In `packages/config-mutations/src/execution/apply-mutation.ts`, `applyTemplateWrite()` resolves and renders the template, checks only whether the target exists, and then unconditionally writes the rendered output whenever the operation is not dry-run. Its returned `MutationOutcome` likewise hard-codes `changed: true` and reports either `create` or `update` based solely on prior path existence, without comparing existing contents to the rendered output.
