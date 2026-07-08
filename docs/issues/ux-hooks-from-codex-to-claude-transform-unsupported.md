# UX: hooks-from codex to claude transform not supported

## Summary

spawn --hooks-from codex fails Transforming hooks from "codex" is not supported yet — help allows --hooks-from and transform strategy but codex→claude path unsupported.

## Evidence

```bash
$ poe-code spawn claude … --hooks-from codex
■  Error: Transforming hooks from "codex" is not supported yet
```

## Why it matters

Advertised combinations fail late.

## Suggested direction

Document supported source→target matrix; filter choices; ValidationError without logs.

## Severity

**High**

## Area

Hooks / spawn
