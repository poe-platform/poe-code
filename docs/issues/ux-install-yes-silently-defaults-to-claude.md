# UX: install --yes without agent silently installs claude-code

## Summary

install without agent non-TTY fails POE_NO_PROMPT; install --yes without agent installs Claude Code with success — silent default agent choice not announced before install.

## Evidence

```bash
$ poe-code install
■  Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
$ poe-code install --yes
◆  Installed Claude Code.
```

## Why it matters

--yes should announce default agent or require agent arg in non-TTY.

## Suggested direction

Require agent non-TTY; or print Installing default agent: claude-code before.

## Severity

**High**

## Area

Install
