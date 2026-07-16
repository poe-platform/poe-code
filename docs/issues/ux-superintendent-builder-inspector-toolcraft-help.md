---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- superintendent builder --help prints 'Usage: npm run dev -- superintendent builder [command] [OPTIONS]'; same for inspector. Root cause src/utils/execution-context.ts:197-201 formatCliUsageCommand returns 'npm run dev --' for mode development, consumed at src/cli/program.ts:840 with toolcraftRoots including superintendentGroup at src/cli/program.ts:845. Named symbol displayBinaryName does not exist in src/ or packages/. Duplicate of ux-superintendent-builder-inspector-npm-run-dev.md; root-cause file is ux-development-mode-usage-intentional-but-leaks.md"
comment: "Duplicate of ux-superintendent-builder-inspector-npm-run-dev.md; retire. Rated High against that file's Medium for identical output; normalise. Its 'displayBinaryName for all toolcraft groups' framing is the correct scope and matches the root cause."
---

# UX: superintendent builder/inspector help uses toolcraft npm run dev identity

## Summary

superintendent builder and inspector --help show Usage: npm run dev -- superintendent builder… — dual help identity reconfirm.

## Evidence

```text
Usage: npm run dev -- superintendent builder [command] [OPTIONS]
```

## Why it matters

Reconfirm toolcraft help identity cluster.

## Suggested direction

displayBinaryName=poe-code for all toolcraft groups.

## Severity

**High**

## Area

Superintendent / identity
