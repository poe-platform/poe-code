# Memory query and explain ignore the project-configured agent override

## Summary

The memory README documents `memory.ingestAgent` in `.poe-code/config.json` as the agent override for `query` and `explain`, but `queryMemory()` and `explainPage()` construct their configuration reader using `<repo>/poe-code.json` with no project config path. Consequently, both APIs ignore the documented project setting and launch the default `claude-code` agent instead.

## Reproduction

From the repository root, create a disposable memory project whose documented config selects a deliberately invalid agent, and place a fake default `claude` executable on `PATH`:

```sh
repo=$PWD
probe=$(mktemp -d)
root="$probe/project/.poe-code/memory"
mkdir -p "$root/pages" "$probe/project/.poe-code" "$probe/bin"

cat > "$probe/project/.poe-code/config.json" <<'EOF'
{
  "memory": {
    "ingestAgent": "definitely-not-an-agent"
  }
}
EOF

printf '# Memory index\n- [facts](pages/facts.md)\n' > "$root/INDEX.md"
printf '# Facts\n\nKnown value.\n' > "$root/pages/facts.md"

cat > "$probe/bin/claude" <<EOF
#!/bin/sh
touch "$probe/default-claude-ran"
printf '%s\n' '{"answer":"should not run default","citations":[],"tokensUsed":1,"exitCode":0}'
exit 0
EOF
chmod +x "$probe/bin/claude"

cat > "$probe/repro.mts" <<EOF
import { queryMemory } from "file://$PWD/packages/memory/src/query.ts";
import { explainPage } from "file://$PWD/packages/memory/src/explain.ts";

await queryMemory("$root", { question: "known?", budget: 4096 });
await explainPage("$root", { relPath: "pages/facts.md", budget: 4096 });
EOF

PATH="$probe/bin:$PATH" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
test -e "$probe/default-claude-ran" && echo default-claude-ran

nl -ba packages/memory/README.md | sed -n '51,55p'
nl -ba packages/memory/src/query.ts | sed -n '30,37p'
nl -ba packages/memory/src/explain.ts | sed -n '42,49p'
```

## Observed Behavior

Both API calls return without rejecting the configured invalid agent, and the marker confirms the default executable ran:

```text
default-claude-ran
```

If `.poe-code/config.json` were being read as documented, resolving `"definitely-not-an-agent"` would not silently launch the default Claude executable. Both implementations instead read `path.join(inferRepoRoot(root), "poe-code.json")`, bypassing `<repo>/.poe-code/config.json`.

## Expected Behavior

`queryMemory()` and `explainPage()` should honor `memory.ingestAgent` from the documented project configuration path, using the selected agent or failing clearly when the configured agent is invalid. They should not silently execute the default agent when a project override exists.

## Impact

Projects cannot control which agent performs memory query and explanation work through the documented configuration. This can execute an unintended local tool, produce responses from the wrong provider/model, and make memory behavior diverge from project policy without warning.
