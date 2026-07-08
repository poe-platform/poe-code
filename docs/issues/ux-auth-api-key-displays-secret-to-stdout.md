# UX: auth api-key prints stored Poe API key to stdout

## Summary

`poe-code auth api-key` is described as "Display stored API key." If this command prints the raw key to stdout it leaks the credential into:
- terminal scrollback buffers
- CI/CD logs (if someone runs it in a pipeline)
- shell history when used in a script substitution (e.g. `curl -H "Authorization: $(poe-code auth api-key)"`)

## Evidence

`auth --help` Commands list:
```
api-key    Display stored API key.
```

No masking, no warning, no `--mask` flag described.

## Why it matters

The Poe API key grants full account access. Printing it to stdout in plaintext is a common credential-leak vector. If a user runs `poe-code auth api-key` in a logged terminal session or a CI step, the key is captured.

## Suggested direction

- Print only the last 4 characters masked (`****...abcd`) by default.
- Add `--reveal` flag for explicit full-key display with a warning.
- Or remove the command entirely and rely on the keychain/credential store to be the single source of truth.

## Severity

High

## Area

Auth / security / credential display
