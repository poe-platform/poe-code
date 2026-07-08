# UX: bare test non-TTY demands POE_NO_PROMPT not --yes

## Summary

test without agent non-TTY: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively + See logs — should honor --yes; POE_NO_PROMPT is obscure.

## Evidence

```bash
$ poe-code test
■  Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
●  See logs …
```

## Why it matters

Non-TTY fail-fast should use --yes; POE_NO_PROMPT is wrong primary guidance.

## Suggested direction

Honor --yes; list agents or default; UserError without logs.

## Severity

**High**

## Area

Test / non-TTY
