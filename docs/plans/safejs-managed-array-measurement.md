---
title: Managed-array memory accounting validation
---

# Managed-array descriptor measurement

The camera profile captured while investigating CLI run 34126409353 identifies
managed-array descriptor capture as a significant measureSandboxData hotspot.
Against 53c8d0b0d, a new regression confirms this path allocates a descriptor
dictionary on each scan. Six baseline controls pass before the implementation.

Capture own string descriptors into a list before visiting retained values,
omitting the unused length descriptor and intermediate dictionary. Keep array
length charging, all own string properties including non-enumerable ones,
accessor safety, sparse-array accounting and snapshot-before-callback semantics.
Do not cache array contents or weaken budget checks.

All 34 focused tests passed after the change, including all camera fixtures.
An isolated 128-element managed-array benchmark (10,000 scans per round) measured
119/106/108 ms for the new path versus 190/199/204 ms for the previous path.
Both paths charged exactly 5,310,000 units each round. These are operation-level
measurements, not proof that the CI timeout is resolved.

The maintained package unit route passed 18,965 tests with 41 optional skips in
589 passing files (311.50 seconds). The unresolved promise-import-properties
policy probe was explicitly excluded. Package TypeScript and ESLint on the
changed TypeScript files passed. The harness pair validates runtime behavior
without agent spawns; it does not claim model-behavior validation.

The real harness passed and its screenshot was inspected after 70 uncached
workspace build tasks (60.227 seconds) plus root stages. Built Node 18.18
managed-array/accessor behavior and public snapshot restoration also passed.
