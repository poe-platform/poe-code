---
severity: medium
impact: usability
comment: "Duplicate in substance of ux-skill-install-name-and-file-both-required-reconfirmed.md; consolidate. Its distinct angle is the ordering - --file is demanded before the missing --name is mentioned - the same one-error-at-a-time problem as ux-memory-write-requires-reason-before-path.md and ux-maestro-tick-missing-transition-raw-commander.md. One fix: report all missing required inputs together."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:91-92 declares .requiredOption --name and --file; `npm run dev -- skill install claude-code --name onlyname --yes --local` prints raw `error: required option '--file <path>' not specified`. Behaviour real but duplicates ux-skill-install-name-and-file-both-required-reconfirmed.md; fix tracked there."
---

# UX: skill install requires --file before reporting missing name/path set

## Summary

skill install claude-code --name onlyname fails required option --file first — both name and file required; order of error is flag-first (related skill install both required).

## Evidence

```bash
$ poe-code skill install claude-code --name onlyname --yes --local
error: required option '--file <path>' not specified
```

## Why it matters

Commander raw error; list all missing fields.

## Suggested direction

ValidationError: require --name and --file together.

## Severity

Medium

## Area

Skills
