---
severity: high
impact: data-loss
comment: "Duplicate of ux-spawn-yes-defaults-mode-to-yolo.md; retire into it. Its fairness is worth carrying - it concedes the help does document the behavior - but that concession is undercut by ux-spawn-yes-not-in-options.md: the documentation lives inside another flag's parenthetical, which is not where anyone looks for the semantics of --yes."
---

# UX: spawn --yes defaults to yolo mode (help says so; verify awareness)

## Summary

spawn --yes without --mode runs successfully (uses yolo per help). Help documents --yes uses yolo — good if users read it; risky default for CI scripts that pass --yes habitually.

## Evidence

```bash
$ poe-code spawn claude "say only: ok" --yes --model haiku
# succeeds (yolo)
# help: --mode … (prompted; --yes uses yolo)
```

## Why it matters

--yes as "accept defaults" also means max permissions — footgun.

## Suggested direction

Require explicit --mode in non-TTY even with --yes; or default --yes to read/auto with warning.

## Severity

**High**

## Area

Spawn / safety
