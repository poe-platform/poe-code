# Poe Agent memory plugin follows symlinked AGENTS files and loads external system instructions

## Summary

The Poe Agent `memoryPlugin()` loads the nearest project `AGENTS.md` and user-level `<home>/.config/poe-code/AGENTS.md` into the system prompt, but does not reject symbolic links at either expected file. If those paths point outside their project or home roots, external content is silently injected as project and user memory instructions.

## Reproduction

From the repository root, create a disposable project and home whose expected memory files point to external Markdown content, then invoke the plugin's prompt transformation:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home/.config/poe-code" "$probe/outside"
printf 'External project instruction\n' > "$probe/outside/project-agents.md"
printf 'External user instruction\n' > "$probe/outside/user-agents.md"
ln -s "$probe/outside/project-agents.md" "$probe/project/AGENTS.md"
ln -s "$probe/outside/user-agents.md" "$probe/home/.config/poe-code/AGENTS.md"

cat > "$probe/repro.mts" <<EOF
import memoryPlugin from "file://$PWD/packages/poe-agent/src/plugins/poe-agent-plugin-memory.ts";

const plugin = memoryPlugin({ cwd: "$probe/project", homeDir: "$probe/home" });
const result = await plugin.prompt!({ system: "Base system", messages: [] } as any);
console.log(result.system);
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/project/AGENTS.md" "$probe/home/.config/poe-code/AGENTS.md"

nl -ba packages/poe-agent/src/plugins/poe-agent-plugin-memory.ts | sed -n '21,73p;75,111p;175,205p'
```

## Observed Behavior

The plugin follows both symlink targets and prepends external content to the generated system prompt as trusted memory:

```text
<probe>/project/AGENTS.md -> <probe>/outside/project-agents.md
<probe>/home/.config/poe-code/AGENTS.md -> <probe>/outside/user-agents.md
Project memory:
External project instruction

User memory:
External user instruction

Base system
```

`findNearestAgentsFile()` and `loadOptionalMemoryFile()` check only whether the expected textual file paths can be read. They never verify the canonical location of the loaded project or user instruction file.

## Expected Behavior

Project memory should be loaded only from canonical `AGENTS.md` files inside the project ancestry, and user memory only from canonical files inside the configured home state path. Symlinked memory files escaping those roots should be rejected or ignored.

## Impact

External Markdown content can be injected into an agent's system instructions while appearing to be normal project or user memory. This can change model behavior, tool decisions, and safety constraints without the instructions being stored in the expected trusted locations.
