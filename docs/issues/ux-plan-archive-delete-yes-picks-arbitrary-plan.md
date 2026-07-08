# UX: plan archive|delete --yes without path mutates an arbitrary plan

## Summary

With --yes and no path, plan archive and plan delete select some plan automatically and perform destructive action without confirming target.

## Evidence

```bash
$ poe-code plan archive --yes
Archived docs/plans/….md
$ poe-code plan delete --yes
Deleted docs/plans/….md
```

## Why it matters

Data loss; --yes means accept defaults not pick random destructive target.

## Suggested direction

Never allow archive/delete without explicit path even with --yes.

## Reconfirmed

```bash
$ poe-code plan archive --yes
Archived docs/plans/toolcraft-human-in-loop-opt-in-exports.md
```
(Restored via git after audit probe.)

## Reconfirmed (delete)

```bash
$ poe-code plan delete --yes
Deleted docs/plans/tiny-http-mcp-server-production-hardening.md
```
(Restored via git after audit probe.)

## Severity

**Critical**

## Area

Plan / destructive
