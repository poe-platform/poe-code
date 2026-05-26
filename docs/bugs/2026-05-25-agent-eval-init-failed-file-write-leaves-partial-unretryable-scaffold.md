# Agent Eval Init Failed File Write Leaves Partial Unretryable Scaffold

## Summary

The exported `evalInit()` initializer creates the evaluation directory and writes its scaffold files without rollback. If one file write fails, it rejects after other scaffold files may already exist; retrying the same initialization then fails because the partial directory is treated as an existing completed eval folder.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/init/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fs: undefined as unknown as ReturnType<typeof createFsFromVolume>["promises"]
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mocks.fs.mkdir(...(args as Parameters<typeof mocks.fs.mkdir>)),
  async writeFile(filePath: string, data: string | Buffer) {
    if (filePath.endsWith("/plan.md")) {
      throw new Error("plan write failed");
    }
    await mocks.fs.writeFile(filePath, data);
  }
}));

const { evalInit } = await import("./init.js");

it("leaves a partial eval directory after one scaffold write fails", async () => {
  mocks.fs = createFsFromVolume(Volume.fromJSON({ "/repo/evals/.keep": "" }, "/")).promises;

  await expect(
    evalInit({ sourceDir: "/repo/evals", name: "partial-task", kind: "plan" })
  ).rejects.toThrow("plan write failed");

  await expect(mocks.fs.readFile("/repo/evals/partial-task/eval.yaml", "utf8")).resolves.toContain("id: partial-task");
  await expect(mocks.fs.readFile("/repo/evals/partial-task/oracle/solution/OUTPUT.md", "utf8")).resolves.toBe("ok\n");
  await expect(mocks.fs.readFile("/repo/evals/partial-task/plan.md", "utf8")).rejects.toThrow();
  await expect(
    evalInit({ sourceDir: "/repo/evals", name: "partial-task", kind: "plan" })
  ).rejects.toThrow("Eval folder already exists: /repo/evals/partial-task");
});
```

Run:

```sh
npm exec -- vitest run packages/agent-eval/src/init/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/agent-eval/src/init/__probe__.test.ts > leaves a partial eval directory after one scaffold write fails
```

Remove the disposable probe after validation.

## Observed Behavior

`evalInit()` creates the destination evaluation directory and its nested folders before issuing five parallel scaffold file writes at `packages/agent-eval/src/init/init.ts:28` through `packages/agent-eval/src/init/init.ts:63`. It rejects existing destination folders before any repair or retry logic at `packages/agent-eval/src/init/init.ts:37` through `packages/agent-eval/src/init/init.ts:44`. In the probe, `plan.md` fails while `eval.yaml` and `oracle/solution/OUTPUT.md` are committed; a second call for `partial-task` rejects with `Eval folder already exists` rather than completing or replacing the failed scaffold.

## Expected Behavior

Evaluation initialization should publish a complete scaffold atomically, clean up newly created directories after any creation failure, or support a safe idempotent retry for a partial scaffold it created. A failed initialization should not permanently reserve the requested eval name with unusable contents.

## Impact

Transient disk, permission, or interrupted-write failures during `eval init` leave partially discoverable evaluation directories that users cannot initialize again without manual diagnosis and deletion. Automation can observe a failed command followed by an existing but invalid eval definition, blocking repeatable setup and potentially confusing later registry or report commands.
