---
severity: low
impact: none
comment: "Positive pattern and another instance of the good validation shape (reject, name the bad value, list the valid ones) already shipping in toolcraft-hosted commands - with ux-configure-unknown-api-shape-lists-exposed.md and the eval format validation, these three prove the convention is established, which makes the 'no allow-list' filings inconsistencies rather than missing features. Its npm run dev residue belongs to the identity cluster."
reproduced: n
recommendation: no-fix
evidence: "packages/github-workflows/src/commands.ts:345 name uses S.Enum(installableAutomations) (values :74-83, first fix-vulnerabilities); allow-list message shape at packages/toolcraft/src/cli.ts:884 - positive note, no defect"
---

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
