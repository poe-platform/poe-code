---
severity: low-medium
impact: polish
comment: "Contentless duplicate within the raw-view framing trio; retire. Its 'document machine' direction is the right answer and matches the resolution the other two reach."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts writeYaml uses process.stdout.write of yamlStringify; rawView skips logger.intro, spinner, and returns before getTheme()/renderTable, so raw output has no design-system framing"
---

# UX: models --view raw bare YAML

## Summary

No framing.

## Evidence

--view raw.

## Why it matters

Contract unclear.

## Suggested direction

Document machine.

## Severity

Low–Medium

## Area

Models
