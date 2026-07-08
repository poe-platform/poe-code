# UX: test kimi fails with Invalid configuration Provider poe not found

## Summary

test kimi --model novitaai/kimi-k2.5 fails: Invalid configuration file … Provider poe not found in providers — configure/test path broken for kimi; raw pydantic error.

## Evidence

```bash
$ poe-code test kimi --model novitaai/kimi-k2.5
■  Error: spawn kimi failed…
│  Invalid configuration file … Provider poe not found in providers
```

## Why it matters

Kimi health check unusable after install alone.

## Suggested direction

configure kimi must write valid providers; UserError with configure hint.

## Severity

**High**

## Area

Test / kimi
