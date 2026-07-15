---
severity: medium
impact: usability
comment: "Keep of this pair. Fair: 'Installed Claude Code' on a second run is indistinguishable from a real install, so users cannot tell whether anything changed or which version they have. Its ask - report already-installed versus updated, with a version - matches the idempotency convention in ux-config-init-already-exists-good.md. Related to the installer umbrella ux-experiment-install-already-exists-vs-pipeline-skip.md, where one concept has several behaviors."
---

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
