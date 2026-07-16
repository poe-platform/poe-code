---
severity: high
impact: usability
comment: "Same validation-order defect as ux-code-review-run-invalid-url-wrong-error.md: an empty agent is reported as a missing --mode, so the error blames a flag the user did not get wrong. Its incidental catch is the more important one and is already Critical elsewhere - the message itself advertises that --yes means yolo (ux-spawn-yes-defaults-mode-to-yolo.md). Fix the order; the --yes default is the bigger problem."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:223 calls resolveSpawnMode(service, ...) before resolveSpawnTarget(container, service) at lines 241/318 (agent validation lives in src/cli/commands/shared.ts:508); resolveSpawnMode throws ValidationError at spawn.ts:490-492 when no --mode and stdin is not a TTY. Probe: `npm run dev -- spawn \"\" \"hi\" --dry-run < /dev/null` printed 'spawn requires --mode when running without an interactive TTY. Pass --mode yolo, --mode auto, --mode edit, or --mode read; or pass --yes to use yolo.' instead of rejecting the empty agent."
---

# UX: spawn with empty agent validates --mode before agent

## Summary

spawn "" "hi" non-TTY: spawn requires --mode … or --yes to use yolo — mode checked before empty agent rejected; also documents --yes→yolo.

## Evidence

spawn requires --mode when running without an interactive TTY. Pass --mode yolo… or pass --yes to use yolo.

## Why it matters

Validation order wrong; reinforces dangerous --yes yolo default.

## Suggested direction

Validate agent first; --yes default auto not yolo.

## Severity

**High**

## Area

Spawn
