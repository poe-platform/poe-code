# UX: auth logout runs immediately without confirmation, silently removes all agent configs

## Summary

`poe-code auth logout` executes immediately without any prompt, confirmation, or `--yes` flag. It removes configuration for every configured agent (Goose, Codex, Gemini CLI, …) and then logs out the Poe account — all silently, in a single keystroke.

## Evidence

```
% poe-code auth logout
  Poe - logout
  Poe - unconfigure goose
◆  Removed Goose configuration.
   Problems? https://github.com/poe-platform/poe-code/issues
  Poe - unconfigure codex
◆  Removed Codex configuration.
   Problems? https://github.com/poe-platform/poe-code/issues
  Poe - unconfigure gemini-cli
◆  Removed Gemini CLI configuration.
   Problems? https://github.com/poe-platform/poe-code/issues
◆  Logged out.
   Problems? https://github.com/poe-platform/poe-code/issues
```

No prompt. No `--yes` required. All agent configurations permanently removed.

## Additional issue: "Problems?" appears 4 times

The `Problems? https://...` footer is repeated after every sub-operation (3 unconfigure + 1 logout = 4 instances). This is extremely noisy and devalues the link — users learn to ignore it.

## Why it matters

A user who accidentally types `poe-code auth logout` loses all agent configurations immediately. Re-configuring each agent requires credentials, API keys, and time. This is the most destructive command in the CLI.

## Suggested direction

- Require confirmation: list what will be removed and prompt "Are you sure? (y/N)", or require `--yes`.
- Add `--dry-run` to preview the list of configurations that would be removed.
- Print "Problems?" only once at the very end, not after each sub-operation.

## Severity

Critical

## Area

Auth / logout / safety / destructive
