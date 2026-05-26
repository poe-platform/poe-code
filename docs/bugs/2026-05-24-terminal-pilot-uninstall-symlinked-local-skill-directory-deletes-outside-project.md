# Terminal Pilot uninstall follows a symlinked local skill directory and deletes outside the project

## Summary

The `terminal-pilot uninstall` implementation resolves a local agent skill path beneath the project and recursively removes it without rejecting a symbolic link in the parent skill directory. A project whose `.codex/skills` entry points externally can therefore cause uninstall to delete an external `terminal-pilot` folder.

## Reproduction

From the repository root, make the project's Codex skill root point at an external directory containing a disposable Terminal Pilot skill, then invoke the same removal helper used by the uninstall command:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.codex" "$probe/outside/skills/terminal-pilot" "$probe/home"
printf 'external skill\n' > "$probe/outside/skills/terminal-pilot/SKILL.md"
ln -s "$probe/outside/skills" "$probe/project/.codex/skills"

cat > "$probe/repro.mts" <<EOF
import {
  getSkillFolderWithHome,
  removeSkillFolder,
  resolveInstallerServices
} from "file://$PWD/packages/terminal-pilot/src/commands/installer.ts";

const services = resolveInstallerServices({
  cwd: "$probe/project",
  homeDir: "$probe/home",
  platform: "darwin"
});
const folder = getSkillFolderWithHome("codex", "local", services.cwd, services.homeDir);
console.log(JSON.stringify(folder));
console.log(await removeSkillFolder(services.fs, folder.fullPath));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/.codex/skills" "$probe/outside/skills"
test ! -e "$probe/outside/skills/terminal-pilot" && printf 'external-folder-deleted\n'

nl -ba packages/terminal-pilot/src/commands/uninstall.ts | sed -n '31,64p'
nl -ba packages/terminal-pilot/src/commands/installer.ts | sed -n '140,185p'
```

## Observed Behavior

The uninstall path is reported as project-local, but removal traverses the linked skill root and deletes the external Terminal Pilot directory:

```text
{"displayPath":".codex/skills/terminal-pilot","fullPath":"<probe>/project/.codex/skills/terminal-pilot"}
true
<probe>/project/.codex/skills -> <probe>/outside/skills
external-folder-deleted
```

## Expected Behavior

Terminal Pilot uninstall should remove only canonical skill folders contained within the selected project or user skill root. A symlinked parent skill directory escaping that root should be rejected before recursive deletion.

## Impact

Uninstalling the Terminal Pilot integration can delete arbitrary external directories named `terminal-pilot` reachable through a project-local skill-root symlink, making a routine cleanup operation destructive outside the project.
