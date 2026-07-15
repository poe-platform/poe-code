---
severity: medium
impact: security
comment: "Better-argued twin of ux-configure-api-key-flag-on-help-shell-history.md - it names both leak vectors (shell history and ps aux for the process lifetime). Still a member of the four-surface --api-key class: fold into the umbrella ux-auth-login-api-key-shell-history-risk.md rather than fixing configure alone, since one policy should cover all four flags."
---

# UX: configure --api-key exposes Poe API key via CLI flag (shell history/process list)

## Summary

`poe-code configure --api-key <key>` accepts the Poe API key as a plaintext CLI flag. The key is then visible in shell history (`~/.zsh_history`, `~/.bash_history`) and in the process list (`ps aux`) for the duration of the command.

## Evidence

```
Options:
  --api-key <key>    Poe API key
```

## Why it matters

Same class as `provider login --api-key` (#245) and `auth` api-key flag. The API key grants full access to the user's Poe account and should never appear in process listings or shell history.

## Suggested direction

Accept the key via stdin prompt (masked), or read it from an env var (`POE_API_KEY`). If a CLI flag must be supported for CI, document the risk and suggest using the env var instead.

## Severity

Medium

## Area

Configure / security / credential exposure
