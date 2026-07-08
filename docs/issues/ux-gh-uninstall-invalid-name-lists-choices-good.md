# UX: gh uninstall invalid name lists valid workflows (positive)

## Summary

Invalid uninstall name lists Expected one of: fix-vulnerabilities, … — good allow-list (still npm run dev help identity).

## Evidence

```bash
$ poe-code gh uninstall no-such-workflow
■  Invalid value for "name". Expected one of: fix-vulnerabilities, …
│  Run npm run dev -- github-workflows uninstall --help
```

## Why it matters

Positive choices list; fix binary name.

## Suggested direction

displayBinaryName=poe-code.

## Severity

Low

## Area

GitHub workflows / positive pattern
