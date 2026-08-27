# Additive preparation amendment v2

This addresses independent `../verification/REVIEW.md` request4 and the current
user's explicit tree/file clarification. It changes the effective preparation
interface only. The original `SEAL.json` and its10 payload files remain unchanged.
Do not run the v1 preparer's `--write` mode. No historical data is duplicated.

## Effective interface

Verify `AMENDMENT_V2_SEAL.json` and its referenced v1 seal first. Load the sealed
v1 `manifest.json` and `amendment-v2.json` as data, then compose in memory:

```js
const effectiveManifest = {
  ...v1Manifest,
  breadth: { ...v1Manifest.breadth, ...amendment.breadthOverrides },
  preparationClarifications: amendment.preparationClarifications,
};
```

Only the three listed breadth ID fields are overlaid. All other v1 fields,
cases, profiles, expected bytes, observations and historical counters remain
unchanged. The new clarification governs the stale prose noted below; original
prose is retained as history. This is not a new candidate or execution approval.

`breadth.sharedControlIds` now enumerates all four in captured recipe order:
`printf-positive`, `terminal-byte-control`, `curl-positive`, `vfs-census-control`.
`sharedDefaultControlIds` retains the original three; `sharedOptionalControlIds`
contains only `curl-positive`. The latter retains `shared-optional-control` and
`loopback-network`, not default registration or automatic network enablement.
The amendment references its original recipe/input hashes and both engines'
sealed optional configurations. Nothing copies or changes those bytes/settings.

Historical accounting remains54 targets +3 overlap controls +4 shared controls
=61 primary recipes;7 diagnostics give68 recipes and136 case/engine outcomes.
These are not a universal union or new execution results. Target positives remain
ours0/baseline47; all-primary positives remain ours7/baseline53.

## Factual clarification, not new holdout design

The user explicitly identifies **tree and file** as the intended additions for
68-to-70. The v1 plan's “unspecified last two” wording is therefore no longer
accurate; it stays byte-exact only as historical text. Names are supplied by the
user, not inferred by subtraction or inspection of source/tests.

The sealed24 proposals cover12 documented target names, **not all70**; none is a
tree/file holdout. Extra tree/file holdouts remain pending a separate source-blind
design, independent native-oracle phase and root-provided frozen candidate
identity. This amendment supplies no new recipes, native expectations, source
inspection, inventory certification or candidate approval. All existing proposals
retain null native expectations and candidate bindings.

## Deterministic bounded check

```sh
node benchmarks/reports/current-comparison-20260827/cohorts/verify-amendment-v2.mjs
```

The checker uses Node builtin read/hash/assert operations only: no child commands,
Git reconstruction, old preparer import, product engine, native utility, network,
timer or installation. Reads are restricted to named files in this directory,
with16MiB per-file and24MiB aggregate bounds. It verifies the original seal and10
payload hashes, the three amendment payload hashes, exact3+1 enumeration,
complete primary partition, optional configuration references and unchanged
curl recipe/input hashes. Six in-memory negative controls reject incomplete,
duplicated, reclassified or byte-hash-altered interfaces. They run no workloads.

V1 seal SHA-256:
`da99ce71943feec45a2bbbae6319e38fb1816522b5ffddbe55ae28b0716ce230`.
V1 content digest:
`46efb75be0663e4606cd616c7e8282ad3e01a367c72cd180703260a55f15d9df`.
The additive seal records the new payload hashes without duplicating old payloads.
It is an integrity record, not mandatory signing infrastructure or root approval.
Only cohorts/** and a /tmp handoff are authored; no stage, commit, root/private
writes, new du work, comparisons or timing. Stop after bounded static checks.
