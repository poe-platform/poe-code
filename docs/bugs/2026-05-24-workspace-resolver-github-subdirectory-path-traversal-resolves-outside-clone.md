# Workspace resolver GitHub subdirectory path traversal resolves outside the cached clone

## Summary

`resolveWorkspace()` accepts the `subdir` portion of a `github://` locator and joins it onto the cached repository directory without constraining traversal segments. A locator such as `github://owner/repo/../../outside` therefore resolves to an existing directory outside the cloned repository while retaining GitHub-repository attribution.

## Reproduction

From the repository root, create a disposable cached-repository directory and an adjacent external directory, then resolve a GitHub workspace locator whose subdirectory traverses to that external path:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/workspaces/github/owner-repo" "$probe/home/.poe-code/workspaces/outside"

cat > "$probe/repro.mts" <<EOF
import { mkdir, stat } from "node:fs/promises";
import { resolveWorkspace } from "file://$PWD/packages/workspace-resolver/src/resolve.ts";

const result = await resolveWorkspace("github://owner/repo/../../outside", {
  homeDir: "$probe/home",
  baseDir: "$probe",
  mode: "read",
  fs: { mkdir, stat },
  async exec(command, args, options) {
    console.log(JSON.stringify({ command, args, cwd: options?.cwd }));
    return { stdout: "", stderr: "", exitCode: 0 };
  }
});
console.log(JSON.stringify(result));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/workspace-resolver/src/parse.ts | sed -n '20,64p;104,124p'
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '7,63p'
```

## Observed Behavior

The resolver treats the traversing locator as a valid GitHub workspace and returns the adjacent external directory as its resolved `cwd`:

```text
{"command":"git","args":["status","--porcelain"],"cwd":"<probe>/home/.poe-code/workspaces/github/owner-repo"}
{"command":"git","args":["pull","--ff-only"],"cwd":"<probe>/home/.poe-code/workspaces/github/owner-repo"}
{"cwd":"<probe>/home/.poe-code/workspaces/outside","locator":{"scheme":"github","owner":"owner","repo":"repo","subdir":"../../outside"}}
```

## Expected Behavior

GitHub locator subdirectories should be constrained to canonical descendants of the resolved cached or writable checkout. Traversing subdirectories that escape the repository root should be rejected before a workspace is returned.

## Impact

Commands intended to run in a selected GitHub repository can instead operate in arbitrary existing sibling directories beneath the workspace state tree, bypassing the repository boundary promised by the locator.
