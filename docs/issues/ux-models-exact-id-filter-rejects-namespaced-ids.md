# UX: models --model requires bare id; namespaced catalog ids return zero

## Summary

models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 find the model. Users copy namespaced ids from the models table and get empty results.

## Evidence

```bash
$ poe-code models --model anthropic/claude-opus-4.7
●  0/341 models
$ poe-code models --model claude-opus-4.7
●  1/341 models
$ poe-code models --search opus-4.7
●  1/341 models — anthropic/claude-opus-4.7
```

## Why it matters

Exact filter unusable with the id format the product displays and configure accepts.

## Suggested direction

Accept namespaced or bare ids in --model; document exact-match form; suggest --search on zero matches.

## Severity

**High**

## Area

Models
