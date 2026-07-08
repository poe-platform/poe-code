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
