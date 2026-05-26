# Skill bridge accepts an agent-prefixed `..` reference and copies entire agent directories outside skill roots

## Summary

The skill bridge treats the name portion of an agent-prefixed reference as an unvalidated path segment. A reference such as `claude-code/..` resolves from `<project>/.claude/skills/..` to the entire `<project>/.claude` directory, then resolves the Codex destination from `<project>/.codex/skills/..` to `<project>/.codex`. This makes a skill-selection input read and copy files outside both agents' intended skill directories.

## Reproduction

From the repository root, create a disposable project containing a file at the parent of Claude Code's skill directory, then bridge the traversing reference into Codex:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.claude" "$probe/home"
printf '# parent directory masquerading as a skill\nRead data from the parent folder.\n' > "$probe/project/.claude/SKILL.md"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { resolveSkillReference } from "file://$PWD/packages/agent-skill-config/src/resolve-skill-reference.ts";
import { bridgeActiveSkills } from "file://$PWD/packages/agent-skill-config/src/bridge-active-skills.ts";

const cwd = "$probe/project";
const homeDir = "$probe/home";
console.log("resolution=" + JSON.stringify(resolveSkillReference("claude-code/..", cwd, homeDir)));
const manifest = bridgeActiveSkills("codex", cwd, ["claude-code/.."], homeDir, "run-1");
console.log("manifest=" + JSON.stringify(manifest));
console.log("copied=" + await readFile(cwd + "/.codex/SKILL.md", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-skill-config/src/resolve-skill-reference.ts | sed -n '64,122p'
nl -ba packages/agent-skill-config/src/bridge-active-skills.ts | sed -n '192,292p'
```

## Observed Behavior

The source resolver accepts `..` as the skill name and normalizes it to the entire Claude Code configuration directory. The bridge then normalizes that same name outside Codex's skill directory and copies the source directory into `<project>/.codex`:

```text
resolution={"kind":"resolved","ref":"claude-code/..","name":"..","sourceAgentId":"claude-code","sourcePath":"<probe>/project/.claude","scope":"project"}
manifest={"spawnAgentId":"codex","cwd":"<probe>/project","runId":"run-1","entries":[{"ref":"claude-code/..","sourcePath":"<probe>/project/.claude","targetPath":"<probe>/project/.codex","createdParents":[]}],"warnings":[]}
copied=# parent directory masquerading as a skill
Read data from the parent folder.
```

`resolveSkillReference()` only rejects empty, whitespace-padded, or additional-slash input before passing `name` through `path.resolve()`. `bridgeActiveSkills()` then uses the same untrusted name when computing its destination and recursively copies that resolved directory.

## Expected Behavior

Skill references should require a safe single skill-directory name and reject `.` or `..` path components before any source or destination path is constructed. Bridging one active skill must only read from the selected source agent's skill directory and write within the spawn agent's skill directory.

## Impact

Any feature that accepts active-skill references can use `agent/..` to disclose and propagate configuration files or other material stored beside an agent's skills, while also writing them outside the target agent's skill root. The resulting copy may place unexpected instruction or configuration files directly in another agent's local configuration directory.
