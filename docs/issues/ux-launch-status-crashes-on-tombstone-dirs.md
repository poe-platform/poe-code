---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/process-launcher/src/launcher.ts:801 listIds() returns every non-file entry in baseDir with no .state-removed- filter, so listManagedProcesses (line 276) calls readSpec on tombstones and throws at line 842 (spec.id !== id), failing all of launch status; state-store.ts:159 filters tombstones in its own list() but launcher does not, and state-store.ts:206 swallows tombstone cleanup failures (test state-store.test.ts:231-243 proves tombstones can persist)"
comment: "Best filing in the launch set, correctly High: after a normal launch rm, leftover .state-removed-* directories are read back as process ids, so status/start/stop all fail with 'Invalid managed process specification' and the entire launch surface is bricked until manual filesystem cleanup. A real defect with a clear mechanism, unlike the turbo-noise filings, and its fix list is precise (skip tombstones when listing, prune them, validate ids strictly). Keep as canonical; absorbs ux-launch-rm-stale-state-removed-id-opaque.md."
---

# UX: launch status errors on leftover .state-removed-* tombstone directories

## Summary

After launch rm, tombstone dirs named .state-removed-<id>-<uuid> can cause subsequent launch status/start/stop to fail with Invalid managed process specification for ".state-removed-…", breaking the whole launch surface until manual cleanup.

## Evidence

```bash
$ poe-code launch rm myproc
$ poe-code launch status
■  Error: Invalid managed process specification for ".state-removed-myproc-…".
●  See logs …
```
Also observed: botched process ids with newlines (from shell parsing) appear as table rows and resist normal rm.

## Why it matters

Core ops command becomes unusable after normal rm; requires filesystem forensics.

## Suggested direction

Ignore/skip .state-removed-* when listing; prune tombstones; validate process ids strictly and refuse newline/control chars; never treat tombstones as process ids.

## Severity

**High**

## Area

Launch
