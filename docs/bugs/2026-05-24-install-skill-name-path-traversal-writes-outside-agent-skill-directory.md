# `installSkill()` name path traversal writes outside the configured agent skill directory

## Summary

The exported `installSkill()` API interpolates caller-controlled `skill.name` directly into the configured agent skill directory without validating it as a single safe folder name. Supplying parent-directory segments causes the installer to create and write `SKILL.md` outside the intended local or global agent skill root.

## Reproduction

From the repository root, invoke the public skill installation API with a disposable local project and a traversing skill name:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home"

cat > "$probe/repro.mts" <<EOF
import * as fsPromises from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { installSkill } from "file://$PWD/packages/agent-skill-config/src/index.ts";

const result = await installSkill(
  "claude-code",
  { name: "../../../outside-skill", content: "# escaped skill\n" },
  {
    fs: fsPromises as any,
    cwd: "$probe/project",
    homeDir: "$probe/home",
    scope: "local"
  }
);

console.log("result=" + JSON.stringify(result));
console.log("outside=" + await readFile("$probe/outside-skill/SKILL.md", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-skill-config/src/apply.ts | sed -n '117,163p'
nl -ba packages/config-mutations/src/execution/path-utils.ts | sed -n '37,67p'
```

## Observed Behavior

The installer accepts the traversing name, returns paths containing it, and creates the skill file outside the project's `.claude/skills` directory:

```text
result={"skillPath":"~/.claude/skills/../../../outside-skill/SKILL.md","displayPath":".claude/skills/../../../outside-skill/SKILL.md"}
outside=# escaped skill
```

For local scope, the intended base is `<project>/.claude/skills/`, while `../../../outside-skill` normalizes to `<probe>/outside-skill/` when the mutation path is expanded.

## Expected Behavior

`installSkill()` should require `skill.name` to be a safe single directory name, rejecting separators, absolute paths, and parent-directory components before constructing mutation targets. Installed skill files must remain within the selected agent skill root.

## Impact

Any SDK or higher-level install command that exposes or derives an insufficiently trusted skill name can be used to write arbitrary `SKILL.md` files outside the selected project or user skill directory. This bypasses the installer's stated storage scope and may place executable agent instructions in unintended locations.
