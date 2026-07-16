---
severity: high
impact: usability
comment: "Keep as canonical of this pair (fuller transcript). Valid: a mistyped github:// locator surfaces raw git stderr plus 'See logs', presenting a plain user error as a system failure with no mapping to the actual cause (bad repo, missing access, or auth). The High is earned because README features github:// workspaces - this is a first-touch path. Same bare-passthrough mechanism as the ENOENT filings; map to a UserError naming the locator and the likely causes."
reproduced: y
recommendation: fix
evidence: "packages/workspace-resolver/src/github/clone.ts:78-84 assertExecSuccess throws plain Error(result.stderr) for failed 'git clone'; src/workspace/resolve-spawn-workspace.ts:34 does not wrap it as CliError, so src/cli/bootstrap.ts:71-79 prints 'Error: <raw git stderr>' plus 'See logs at .../errors.log'."
---

# UX: --cwd github:// invalid still surfaces raw git clone errors (reconfirmed)

## Summary

Invalid github://owner/repo still dumps Cloning into… ERROR: Repository not found fatal… See logs — reconfirm of github-cwd-clone-errors-unframed.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --cwd github://not/a/repo
■  Error: Cloning into '…'
│  ERROR: Repository not found.
│  fatal: Could not read from remote repository.
●  See logs …
```

## Why it matters

Reconfirmed raw git error framing.

## Suggested direction

UserError: Repository not found or access denied for github://…; suggest auth/permissions.

## Severity

**High**

## Area

Spawn / github
