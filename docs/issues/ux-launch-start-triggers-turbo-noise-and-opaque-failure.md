---
severity: high
impact: usability
comment: "Duplicate of ux-launch-start-triggers-turbo-monorepo-build.md; retire into it. Same split applies: the turbo half is a dev-mode artefact, the 'surface the command's stderr' half is the real ask."
reproduced: y
recommendation: no-fix
evidence: "packages/process-launcher/src/launcher.ts:144 throws Error(`Managed process \"${spec.id}\" failed to start.`) with no command stderr or log tail; turbo output is an npm run dev predev artefact, not product code. Duplicate of ux-launch-start-triggers-turbo-monorepo-build.md."
---

# UX: launch start triggers monorepo turbo build noise then opaque failed to start

## Summary

launch start foo -- echo hi (and without --) prints full turbo monorepo build output then Managed process failed to start without stderr of the command — reaffirm launch opaque failure + turbo noise.

## Evidence

```bash
$ poe-code launch start foo -- echo hi
• turbo 2.9.18
  … Packages in scope: … 68 packages …
■  Error: Managed process "foo" failed to start.
```

## Why it matters

Impossible to debug launch; turbo noise looks like product crash.

## Suggested direction

Do not run turbo on launch start; surface command stderr; validate command exists.

## Severity

**High**

## Area

Launch
