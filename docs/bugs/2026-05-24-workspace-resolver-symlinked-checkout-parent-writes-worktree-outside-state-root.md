# Workspace resolver follows a symlinked checkout parent and writes a worktree outside state root

## Summary

`createWritableCheckout()` creates editable GitHub worktrees below `<home>/.poe-code/workspaces/checkouts/<owner>-<repo>` without rejecting a symbolic link at that repository-specific parent directory. A normal editable workspace resolution can therefore materialize an entire worktree in an external filesystem location.

## Reproduction

From the repository root, create a disposable source repository and link the selected checkout parent to an external directory, then invoke the exported writable-checkout function with a real local Git executor:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/source" "$probe/home/.poe-code/workspaces/checkouts" "$probe/outside/checkouts"
(
  cd "$probe/source"
  git init -q -b main
  git config user.email probe@example.invalid
  git config user.name Probe
  printf x > README.md
  git add README.md
  git commit -q -m init
)
ln -s "$probe/outside/checkouts" "$probe/home/.poe-code/workspaces/checkouts/owner-repo"

cat > "$probe/repro.mts" <<EOF
import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { createWritableCheckout } from "file://$PWD/packages/workspace-resolver/src/github/isolation.ts";

const execFileAsync = promisify(execFile);
const result = await createWritableCheckout({ scheme: "github", owner: "owner", repo: "repo" }, "$probe/source", {
  homeDir: "$probe/home",
  baseDir: "$probe",
  fs: { mkdir, rm, stat },
  async exec(command, args, options) {
    const output = await execFileAsync(command, args, { cwd: options?.cwd });
    return { stdout: output.stdout, stderr: output.stderr, exitCode: 0 };
  }
});
console.log(result.cwd);
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/home/.poe-code/workspaces/checkouts/owner-repo"
find "$probe/outside/checkouts" -maxdepth 2 -name README.md -print -exec cat {} \;

nl -ba packages/workspace-resolver/src/github/isolation.ts | sed -n '4,38p'
```

## Observed Behavior

The returned checkout path appears under the selected home, but Git creates the actual worktree content beneath the external symlink target:

```text
<probe>/home/.poe-code/workspaces/checkouts/owner-repo/<checkout-id>
<probe>/home/.poe-code/workspaces/checkouts/owner-repo -> <probe>/outside/checkouts
<probe>/outside/checkouts/<checkout-id>/README.md contains: x
```

## Expected Behavior

Writable checkouts should be created only in canonical directories contained under the selected home-state checkout root. A symlinked repository-specific checkout parent escaping that root should be rejected before invoking `git worktree add`.

## Impact

Opening an editable GitHub workspace can create a complete writable checkout and subsequent agent changes outside Poe's intended state directory, redirecting repository mutations into an externally selected location.
