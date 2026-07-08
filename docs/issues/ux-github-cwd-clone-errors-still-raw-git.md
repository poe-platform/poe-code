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
