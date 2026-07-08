# UX: --reasoning-effort may be silently ignored or not reflected for Claude configure

## Summary

configure claude --reasoning-effort low|medium|max --yes --dry-run still plans effortLevel xhigh (or does not show a resolved reasoning line), while codex dry-run does surface model_reasoning_effort changes. The global flag appears accepted without agent-specific feedback when unsupported or remapped.

## Evidence

```bash
$ poe-code configure claude --reasoning-effort low --yes --dry-run
# still shows effortLevel xhigh in planned settings; no "resolved reasoning" line
$ poe-code configure codex --reasoning-effort low --yes --dry-run
# shows model_reasoning_effort changes
```
Help lists --reasoning-effort for all configure without per-agent support notes.

## Why it matters

Users believe they set low effort for cost control; config may not change.

## Suggested direction

Per-agent support in help; error or warn when flag ignored; always print resolved effort.

## Severity

**High**

## Area

Configure
