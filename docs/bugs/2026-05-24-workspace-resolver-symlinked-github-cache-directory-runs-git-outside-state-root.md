# Workspace resolver follows a symlinked GitHub cache directory and runs Git outside state root

## Summary

`cloneOrUpdate()` treats `<home>/.poe-code/workspaces/github/<owner>-<repo>` as the cached repository directory without rejecting a symbolic link at that path. A safe GitHub locator can therefore cause Git status and pull operations to execute in an external directory outside Poe's workspace cache root.

## Reproduction

From the repository root, point the nominal cached repository entry at an external directory and resolve a normal read-only GitHub workspace using a recording executor:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/workspaces/github" "$probe/outside/cache"
ln -s "$probe/outside/cache" "$probe/home/.poe-code/workspaces/github/owner-repo"

cat > "$probe/repro.mts" <<EOF
import { mkdir, stat } from "node:fs/promises";
import { resolveWorkspace } from "file://$PWD/packages/workspace-resolver/src/resolve.ts";

console.log(JSON.stringify(await resolveWorkspace("github://owner/repo", {
  homeDir: "$probe/home",
  baseDir: "$probe",
  mode: "read",
  fs: { mkdir, stat },
  async exec(command, args, options) {
    console.log(JSON.stringify({ command, args, cwd: options?.cwd }));
    return { stdout: "", stderr: "", exitCode: 0 };
  }
})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/home/.poe-code/workspaces/github/owner-repo"

nl -ba packages/workspace-resolver/src/github/clone.ts | sed -n '4,63p'
nl -ba packages/workspace-resolver/src/resolve.ts | sed -n '18,43p'
```

## Observed Behavior

The resolver issues Git operations using the local-looking symlink path, which resolves to the external cache target:

```text
{"command":"git","args":["status","--porcelain"],"cwd":"<probe>/home/.poe-code/workspaces/github/owner-repo"}
{"command":"git","args":["pull","--ff-only"],"cwd":"<probe>/home/.poe-code/workspaces/github/owner-repo"}
{"cwd":"<probe>/home/.poe-code/workspaces/github/owner-repo","locator":{"scheme":"github","owner":"owner","repo":"repo"}}
<probe>/home/.poe-code/workspaces/github/owner-repo -> <probe>/outside/cache
```

## Expected Behavior

Cached GitHub workspace entries should resolve only to canonical directories contained under the selected home-state workspace cache. A symlinked cache entry escaping that root should be rejected before running Git commands.

## Impact

Resolving an ordinary GitHub workspace can run repository-update commands in an externally selected location, allowing unreviewed repositories outside Poe's state tree to be inspected or modified as trusted cache entries.
