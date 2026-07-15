---
severity: low
impact: none
comment: "Positive pattern and the useful half of the update cluster: --package-manager bun correctly produces 'bun install -g poe-code@latest', proving the package manager is parameterised and only the detection is missing. That reframes ux-update-always-suggests-npm-install-g.md from 'support other managers' to 'detect the current one and default to it' - a much smaller change. Keep and link."
---

# UX: update --package-manager bun works (positive)

## Summary

update --package-manager bun --dry-run correctly plans bun install -g poe-code@latest — positive package-manager override behavior (still always -g).

## Evidence

```bash
$ poe-code update --package-manager bun --dry-run
◇  Command
│     bun install -g poe-code@latest
```

## Why it matters

Documents working override; still subject to always-global install issue.

## Suggested direction

Keep override; fix global-only assumption separately.

## Severity

Low

## Area

Update / positive pattern
