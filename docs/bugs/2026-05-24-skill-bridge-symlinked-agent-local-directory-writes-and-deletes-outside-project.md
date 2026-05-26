# Active skill bridging follows a symlinked agent-local directory outside the project

## Summary

`bridgeActiveSkills()` resolves its target path textually beneath the spawned agent's project-local skills directory, but does not validate canonical containment. If that local skills directory is a symlink to an external directory, bridging a skill copies it into the external target, and `cleanupBridgedSkills()` later recursively deletes the external copied skill.

## Reproduction

From the repository root, create a disposable project with one Poe Code skill and a symlinked OpenCode local skills directory, then bridge and clean up the skill:

```sh
repo=$PWD
probe=$(mktemp -d)
cwd="$probe/project"
home="$probe/home"
outside="$probe/outside"
mkdir -p "$cwd/.poe-code/skills/foo" "$cwd/.opencode" "$home" "$outside"
printf '# Source Skill\n' > "$cwd/.poe-code/skills/foo/SKILL.md"
ln -s "$outside" "$cwd/.opencode/skills"
git -C "$cwd" init -q

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { bridgeActiveSkills, cleanupBridgedSkills } from "file://$PWD/packages/agent-skill-config/src/index.ts";

const manifest = bridgeActiveSkills("opencode", "$cwd", ["foo"], "$home", "run-1");
console.log("target=" + manifest.entries[0]?.targetPath);
console.log("written=" + await readFile("$outside/foo/SKILL.md", "utf8"));
cleanupBridgedSkills(manifest);
console.log("existsAfterCleanup=" + String(await stat("$outside/foo/SKILL.md").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-skill-config/src/configs.ts | sed -n '12,32p;96,106p'
nl -ba packages/agent-skill-config/src/bridge-active-skills.ts | sed -n '115,129p;192,293p'
```

## Observed Behavior

The bridge regards `.opencode/skills/foo` as a project-local target while its parent symlink routes the copy and cleanup outside the project:

```text
target=.../project/.opencode/skills/foo
written=# Source Skill
existsAfterCleanup=false
```

The requested skill reference is a normal `foo` entry. No traversal is required; filesystem resolution of `.opencode/skills -> outside` redirects both lifecycle operations.

## Expected Behavior

Transient active-skill bridge files should remain beneath the canonical local skill directory for the spawned agent, or bridging should reject a local skill directory that resolves outside the project before copying or deleting content.

## Impact

A crafted project symlink can redirect skill-bridge writes into arbitrary external writable directories and cause subsequent cleanup to recursively delete the externally created skill directory. This breaks the intended temporary project-local bridge boundary during normal spawned-agent setup and teardown.
