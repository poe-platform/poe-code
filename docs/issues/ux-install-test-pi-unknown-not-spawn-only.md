---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/install.ts:47 and src/cli/commands/test.ts:92 call resolveServiceAdapter, which throws 'Unknown agent \"pi\".' at src/cli/commands/shared.ts:491 because no pi provider exists in src/providers/index.ts; spawn.ts:240 uses resolveSpawnTarget, which resolves pi via packages/agent-spawn/src/configs/pi.ts:9"
comment: "Keep as the best statement of the spawn-only messaging problem: it shows install, test and spawn --help side by side, proving pi is known to one command and unknown to two. Retire ux-install-pi-unknown-not-in-installable-list.md and ux-unconfigure-pi-unknown-not-spawn-only.md into it, and treat the family as evidence for ux-agent-capability-matrix-spawn-vs-configure-vs-install.md. 'Unknown agent' is factually wrong here, which is what makes it worth fixing rather than merely improving."
---

# UX: install/test pi says Unknown agent not spawn-only

## Summary

install pi and test pi: Unknown agent "pi" + See logs — but spawn accepts pi. Capability matrix: should say pi is spawn-only, not unknown.

## Evidence

```bash
$ poe-code install pi --yes
■  Unknown agent "pi".
$ poe-code test pi
■  Unknown agent "pi".
$ poe-code spawn --help  # includes pi | pi-agent | poe-agent
```

## Why it matters

Reconfirm capability matrix messaging for spawn-only agents.

## Suggested direction

pi is spawn-only (not installable/testable). See spawn pi.

## Severity

**High**

## Area

Install / capability
