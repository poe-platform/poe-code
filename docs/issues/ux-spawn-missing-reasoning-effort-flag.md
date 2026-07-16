---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- spawn --help lists no --reasoning-effort (src/cli/commands/spawn.ts:95-137 plus addRuntimeOptions in src/cli/commands/runtime-options.ts:11-25); the flag exists only at src/cli/commands/configure.ts:78"
comment: "Good filing and a genuine capability gap: effort is a per-run cost decision and is only settable via configure, so CI must mutate global config to change one run - the wrong shape. Its own suggestion notes the constraint that matters: any spawn-time flag needs the model-aware allow-list from ux-effort-xhigh-valid-for-opus-not-sonnet.md, otherwise it reproduces the xhigh-on-sonnet bug at run time. Sequence after the effort cluster; it also makes ux-configure-reasoning-effort-still-ignored-always-high.md less painful by giving users a working alternative."
---

# UX: spawn has no --reasoning-effort (configure-only footgun)

## Summary

spawn --reasoning-effort xhigh|high is unknown option; flag exists only on configure. Users expect spawn-time effort override; must configure first or use agent-specific env.

## Evidence

```bash
$ poe-code spawn claude "…" --mode read --model anthropic/claude-sonnet-4.6 --reasoning-effort high
error: unknown option '--reasoning-effort'
# configure has --reasoning-effort <level>
```

## Why it matters

Effort is a run-time concern for CI; forcing configure is wrong shape.

## Suggested direction

Add spawn/gaslight --reasoning-effort with model-aware allow-list (no xhigh on sonnet-4.6).

## Severity

**High**

## Area

Spawn
