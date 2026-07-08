# UX: plan markdown-read --depth 0/1 can show sections (none) incorrectly

## Summary

plan markdown-read with --depth 1 on a plan whose headings start at depth 2-style numbering may print sections: (none) while section 1 content exists via markdown-read-section — depth filter surprises.

## Evidence

```bash
$ poe-code plan markdown-read docs/plans/32-agent-goal.md --depth 1
sections:
  (none)
$ poe-code plan markdown-read-section … "1"
## 1. What we're building
… content …
```

## Why it matters

Depth filter looks broken for common plan heading styles.

## Suggested direction

Document depth semantics; default depth unlimited; warn when filter empties TOC.

## Severity

Medium

## Area

Plan
