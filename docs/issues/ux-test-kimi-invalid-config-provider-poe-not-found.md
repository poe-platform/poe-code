---
severity: high
impact: correctness
comment: "Keep as canonical of this pair and more serious than its framing suggests: 'Provider poe not found in providers' means our own configure wrote a kimi config whose default_model references a provider it never defined - poe-code produced an internally inconsistent config. That is a correctness bug in configure rather than a test problem, and it connects to the kimi namespace cluster (ux-kimi-default-model-id-mismatches-catalog-namespace.md): default_model is written as poe/kimi-k2.5 while no poe provider block exists. The raw pydantic error is secondary."
---

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
