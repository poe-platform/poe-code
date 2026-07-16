---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/prompts/interactive/core.ts:133 rejects non-TTY prompts naming only POE_NO_PROMPT; src/cli/commands/configure.ts:1024-1027 resolveServiceArgument short-circuits on flags.assumeYes. Probe: 'npm run dev -- install --dry-run </dev/null' errors 'Interactive prompt requires a TTY. Set POE_NO_PROMPT=1', while adding --yes prints 'Claude Code install (dry run)'."
comment: "One of several POE_NO_PROMPT-versus---yes filings (configure, test, runtime init, gaslight ingest); consolidate into one shared non-TTY message issue. Its evidence is the crispest of the set - install --yes demonstrably works, so the message names the obscure env var while omitting the flag that already does the job. Fix the shared message once: name --yes first, env var only as the CI alternative."
---

# UX: install without agent non-TTY demands POE_NO_PROMPT not --yes

## Summary

install without agent in non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — --yes should select default agent per project policy.

## Evidence

```bash
$ poe-code install
■  Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
```
install --yes works with default claude.

## Why it matters

Inconsistent --yes vs POE_NO_PROMPT across commands.

## Suggested direction

Honor --yes for default agent; document; prefer --yes over POE_NO_PROMPT.

## Severity

**High**

## Area

Install / non-TTY
