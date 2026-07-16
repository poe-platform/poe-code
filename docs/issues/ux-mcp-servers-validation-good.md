---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/mcp-spawn-config.ts:75 throws ValidationError '--mcp-servers entry \"x\" must include a non-empty string \"command\"'; positive note, no defect to reproduce"
comment: "Duplicate within the --mcp-servers positive set; retire into ux-mcp-servers-file-and-json-validation-good.md. Its field-level message ('entry \"x\" must include a non-empty string \"command\"') is the strongest example in the set and should survive as the quoted reference - it names the entry, the field and the constraint."
---

# UX: --mcp-servers invalid entry validation is good (positive)

## Summary

Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome.

## Evidence

```bash
$ poe-code spawn … --mcp-servers '{"x":{}}'
■  --mcp-servers entry "x" must include a non-empty string "command"
```

## Why it matters

Positive validation pattern to copy.

## Suggested direction

Keep; use for other JSON flags.

## Severity

Low

## Area

Spawn / positive pattern
