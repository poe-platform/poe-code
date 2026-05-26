# Poe Agent memory plugin import path traversal loads instructions outside the project

## Summary

The Poe Agent `memoryPlugin()` supports `@relative/path.md` imports within `AGENTS.md`, but resolves import strings with `path.resolve()` and does not enforce containment beneath the memory document's trusted root. A project `AGENTS.md` can use `../` to import arbitrary readable Markdown content outside the project into the agent system prompt.

## Reproduction

From the repository root, create a disposable project whose local memory file imports a sibling external document and invoke the plugin's prompt transformation:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home" "$probe/outside"
printf '@../outside/external.md\n' > "$probe/project/AGENTS.md"
printf 'Imported external instruction\n' > "$probe/outside/external.md"

cat > "$probe/repro.mts" <<EOF
import memoryPlugin from "file://$PWD/packages/poe-agent/src/plugins/poe-agent-plugin-memory.ts";

const plugin = memoryPlugin({ cwd: "$probe/project", homeDir: "$probe/home" });
const result = await plugin.prompt!({ system: "Base system", messages: [] } as any);
console.log(result.system);
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/poe-agent/src/plugins/poe-agent-plugin-memory.ts | sed -n '45,73p;96,165p;190,197p'
```

## Observed Behavior

The plugin resolves `@../outside/external.md` outside the project and inserts that content into the system instructions:

```text
Project memory:
Imported external instruction

Base system
```

`expandImports()` extracts the import path and computes `path.resolve(path.dirname(normalizedPath), importPath)`, then reads the resulting file directly without checking whether it remains within the project or another approved memory root.

## Expected Behavior

Imports from a project `AGENTS.md` should be constrained to approved canonical project memory locations, or require an explicit opt-in for external files. Traversal paths escaping the project should not silently become system instructions.

## Impact

A project memory file can import neighboring filesystem content into the model's system prompt, enabling hidden instruction injection from outside the reviewed project tree. This bypass does not require filesystem symlinks and may also disclose external Markdown content to agent execution.
