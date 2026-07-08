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
