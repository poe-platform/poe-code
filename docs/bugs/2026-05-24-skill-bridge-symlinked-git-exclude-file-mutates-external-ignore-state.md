# Skill bridge follows a symlinked Git exclude file and mutates external ignore state

## Summary

When active skills are bridged into a spawn agent, the bridge records its generated paths in the repository's `.git/info/exclude` file and later removes that block during cleanup. The bookkeeping code does not reject symbolic links at the exclude-file path. If `.git/info/exclude` is a symlink to an external file, ordinary bridge setup and cleanup rewrite that external file.

## Reproduction

From the repository root, initialize a disposable Git project with one native skill, replace `.git/info/exclude` with a symlink to an external file, then bridge and clean up the skill:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.claude/skills/native" "$probe/home" "$probe/outside"
printf '# bridged skill\n' > "$probe/project/.claude/skills/native/SKILL.md"
(
  cd "$probe/project"
  git init -q
)
printf '# outside exclude seed\n' > "$probe/outside/exclude"
rm "$probe/project/.git/info/exclude"
ln -s "$probe/outside/exclude" "$probe/project/.git/info/exclude"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { bridgeActiveSkills, cleanupBridgedSkills } from "file://$PWD/packages/agent-skill-config/src/bridge-active-skills.ts";

const cwd = "$probe/project";
const manifest = bridgeActiveSkills("codex", cwd, ["claude-code/native"], "$probe/home", "run-exclude");
console.log("manifest=" + JSON.stringify(manifest));
console.log("afterBridge=" + await readFile("$probe/outside/exclude", "utf8"));
cleanupBridgedSkills(manifest);
console.log("afterCleanup=" + await readFile("$probe/outside/exclude", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/.git/info/exclude"

nl -ba packages/agent-skill-config/src/git-exclude.ts | sed -n '20,130p'
nl -ba packages/agent-skill-config/src/bridge-active-skills.ts | sed -n '255,292p'
```

## Observed Behavior

The normal bridge operation appends its generated-skill ignore block to the external file reached through `.git/info/exclude`, and cleanup rewrites the same external file to remove that block:

```text
<probe>/project/.git/info/exclude -> <probe>/outside/exclude
afterBridge=# outside exclude seed
# poe-code-spawn-skills:run-exclude begin
.codex/skills/native
# poe-code-spawn-skills:run-exclude end

afterCleanup=# outside exclude seed
```

`appendExcludeBlock()` and `removeExcludeBlock()` obtain the textual Git exclude path and use synchronous read/write calls at that path. `bridgeActiveSkills()` invokes the append step after copying skills, while `cleanupBridgedSkills()` invokes removal during teardown; neither rejects a symlinked ignore file.

## Expected Behavior

Temporary bridge-ignore entries should be written only to the actual ignore file belonging to the selected repository, or the operation should reject a `.git/info/exclude` entry that resolves outside the Git metadata directory. Cleanup must not rewrite unrelated external files through repository-local symlinks.

## Impact

A crafted or compromised repository can redirect automatic skill-bridge bookkeeping into any user-writable external text file by symlinking `.git/info/exclude`. Normal spawn preparation and cleanup then append and remove marker blocks outside the repository, unexpectedly mutating unrelated user data.
