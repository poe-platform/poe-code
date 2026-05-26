# Maestro open source action reports edited after editor fails

## Summary

The Maestro TUI `Open in $EDITOR` action refreshes the task list and displays an informational `Edited ...` toast even when the configured editor exits with a nonzero failure status. The TUI therefore positively confirms an edit that did not complete successfully.

## Reproduction

From the repository root, run a disposable Vitest probe with an executable editor script that immediately exits with status `17`:

```sh
cat > /tmp/maestro-open-source-false-success-probe.test.ts <<'EOF'
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildOpenSourceAction } from "./actions.js";

function makeTask(sourcePath: string) {
  return {
    id: "file",
    qualifiedId: "tasks/file",
    list: "tasks",
    state: "planned",
    title: "File",
    description: "",
    metadata: {},
    sourcePath
  } as never;
}

describe("maestro open-source action editor failure", () => {
  it("toasts Edited after the configured editor exits nonzero", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "maestro-editor-failure-"));
    const sourcePath = path.join(root, "task.md");
    const editorPath = path.join(root, "editor.sh");
    writeFileSync(sourcePath, "# Task\n");
    writeFileSync(editorPath, "#!/bin/sh\nexit 17\n");
    chmodSync(editorPath, 0o755);
    const action = buildOpenSourceAction({ taskByRowId: () => new Map([["row", makeTask(sourcePath)]]), variables: { EDITOR: editorPath } });
    const refresh = vi.fn(async () => undefined);
    const toast = vi.fn();
    await action.handler!({ row: { id: "row" }, suspendAnd: async (run: () => unknown) => run(), refresh, toast } as never);
    console.log(JSON.stringify({ refreshCalls: refresh.mock.calls.length, toast: toast.mock.calls }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Edited tasks/file", "info");
  });
});
EOF
cp /tmp/maestro-open-source-false-success-probe.test.ts packages/maestro-tui/src/__probe__.test.ts
trap 'rm -f packages/maestro-tui/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/maestro-tui/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The failed editor run is followed by a refresh and a success-style information toast:

```text
{"refreshCalls":1,"toast":[["Edited tasks/file","info"]]}
✓ packages/maestro-tui/src/__probe__.test.ts > maestro open-source action editor failure > toasts Edited after the configured editor exits nonzero
```

`packages/maestro-tui/src/actions.ts:94` through `packages/maestro-tui/src/actions.ts:107` call `editFile()` and unconditionally refresh and toast `Edited ...` after it returns. The delegated editor helper at `packages/plan-browser/src/actions.ts:12` through `packages/plan-browser/src/actions.ts:21` invokes `spawnSync()` without checking its exit status, so a nonzero editor exit is indistinguishable from success to the Maestro action.

## Expected Behavior

The Maestro action should report success only when the editor command launches and completes successfully; a failed editor status should surface an error and must not display an `Edited` toast.

## Impact

Users are told a task source was edited even when their editor failed immediately. In an interactive workflow this masks configuration or editor failures and can cause users to continue believing changes were saved when no successful editing session occurred.
