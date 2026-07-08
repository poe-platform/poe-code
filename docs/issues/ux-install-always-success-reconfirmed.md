# UX: install always claims Installed even when already present (reconfirmed)

## Summary

install claude-code when already installed still says Installed Claude Code without version/already-present distinction.

## Evidence

```bash
$ poe-code install claude-code
◆  Installed Claude Code.
```

## Why it matters

Reconfirm of install-always-claims-success.

## Suggested direction

Report already installed version or updated.

## Severity

Medium

## Area

Install
