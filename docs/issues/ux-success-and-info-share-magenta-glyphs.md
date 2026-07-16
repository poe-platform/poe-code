---
severity: low-medium
impact: polish
comment: "Contentless but it names the mechanism behind a real family: if success and info share a colour, glyphs carry less signal than they appear to - the same erosion ux-failure-shown-as-success-markers.md describes from the semantic side. Fold the two into one status-language pass: colour and glyph should agree and both should mean something. Its 'success green' suggestion needs a design decision rather than a bug fix."
reproduced: y
recommendation: fix
evidence: "src/cli/logger.ts:79-80 - infoSymbol = chalk.magenta(\"●\") and successSymbol = chalk.magenta(\"◆\"); both status glyphs use the same magenta colour, so colour carries no info/success signal."
---

# UX: Success/info both magenta

## Summary

logger ◆ and ● magenta.

## Evidence

logger.ts.

## Why it matters

Hard scan.

## Suggested direction

Success green.

## Severity

Low–Medium

## Area

Visual language
