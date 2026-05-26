# Ralph run follows a symlinked base directory and loads external workflow configuration

## Summary

Ralph document configuration resolution searches project-local bases beneath `<project>/.poe-code/ralph/bases` when a document declares `extends: true`. It does not verify canonical containment of that base directory. If the project base directory is a symbolic link to an external location, running an otherwise local document loads external inherited configuration and uses it to select execution behavior.

## Reproduction

From the repository root, create a project whose Ralph base directory points outside the project, then run a local document inheriting its matching base:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.poe-code/ralph" "$probe/project/docs/plans" "$probe/home" "$probe/outside"
ln -s "$probe/outside" "$probe/project/.poe-code/ralph/bases"
cat > "$probe/outside/linked.md" <<'EOF'
---
kind: ralph
agent: codex
iterations: 1
prompt: External base secret prompt
---
EOF
cat > "$probe/project/docs/plans/linked.md" <<'EOF'
---
kind: ralph
extends: true
---
EOF

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { runRalph } from "file://$PWD/packages/ralph/src/run/ralph.ts";

const calls = [];
const result = await runRalph({
  cwd: "$probe/project",
  homeDir: "$probe/home",
  docPath: "docs/plans/linked.md",
  fs: fs as any,
  runAgent: async (input) => {
    calls.push({ agent: input.agent, prompt: input.prompt });
    return { stdout: "", stderr: "", exitCode: 0 };
  }
});
console.log("calls=" + JSON.stringify(calls));
console.log("result=" + JSON.stringify(result));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/.poe-code/ralph/bases"

nl -ba packages/ralph/src/run/ralph.ts | sed -n '242,294p'
nl -ba packages/config-extends/src/discover.ts | sed -n '1,120p'
```

## Observed Behavior

Although the local document does not select an agent, Ralph resolves its base through the external symlink target and runs using the external base's `agent: codex` value instead of the built-in Claude default:

```text
<probe>/project/.poe-code/ralph/bases -> <probe>/outside
calls=[{"agent":"codex","prompt":""}]
result={"stopReason":"max_iterations","docPath":"docs/plans/linked.md","iterationsCompleted":1,...}
```

The external base content is sufficient to influence execution even when its prompt is not surfaced in this fixture. `resolveDocumentConfigFromContent()` supplies the project base directory to config extension resolution, and base discovery reads the matching document from the symlink target as a trusted inheritance layer.

## Expected Behavior

Project Ralph base inheritance should read configuration only from canonical base files inside the selected project's Ralph base directory. A symlinked base directory escaping the project should be rejected before inherited agent, iterations, prompts, skills, or hook configuration can affect execution.

## Impact

A crafted project can redirect Ralph inheritance to external workflow configuration and silently alter which agent or behavior runs for a local document. External base data may affect prompts, enabled skills or hooks, and execution limits while appearing to originate from project-local state.
