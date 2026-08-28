# S01 allocation-unwind correction — author handoff

2026-08-28. AUTHOR_SCOPED_PASS; independent acceptance pending Sagan. One authorized run; no retries, native Git, private engine, network, root exports or default integration.

## Exact candidate

- Source commit: fca6f81d2d96db2bbceabf3247cd57ffe240bde6.
- Base: coherent78 8437e4eda904e1248c25eeef0d9d455b1d251495, no arrays/liveHEAD.
- Derived-only tree: 23074ef0c443ca618c4f26204b5f3d2274b86895;282 authenticated selected inputs, not a claim that the computed tree is a stored object.
- SOURCE.json SHA256: ce54b742cb00f0df0f14fc6865e73a614334ddfd7ac4aeabcc30f7f4c1eb70d9. EXECUTOR.json SHA256: be85284239a3f11d1d6e836d56260fc0ad625a311e6cdb191f78443c87bf670d.
- Full910-member806626-byte package: cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a. Package bytes are results-v3/PACKAGE.tgz.base64; no README omission.
- pack.ts SHA256: 42c9d44c1648a139c3c6414228b050923c2280194eb818428676b3cce88627ce; compiled pack.js SHA256: 8517ec58e2c8b8704908e9fa9347ea60dd9382422a53b4716eeb226726e39656.

## Root cause and exact correction

S01 from independent4db769480118ebf935f8e26fca80a353c55e493d is valid: original09029163 allocated slots, then buckets, before entering the finally that releases both. A second reserve/Buffer.alloc throw could bypass the first owner's cleanup. Session.allocate only unwinds its own failed reservation.

The sole source delta moves second allocation and rows construction inside the first owner's try/finally, with optional buckets released only if acquired. limits.ts, all13 other module files, public types/options, cache pinning, and normal query semantics are byte-identical. SOURCE.patch preserves the exact delta. Package comparison changes only pack.js and its two maps;907 members unchanged, including declarations/API/package/README.

## Execution and controls

Recipe7764a8f3 and source binding13db7868 were committed before the sole run. Actual command: pinned /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/git-pack-author-20260828/s01-v3/run.mjs --run.

| Cohort | Source build | Installed | Moved |
| --- | ---: | ---: | ---: |
| Unchanged M1A |140/140|140/140|140/140|
| Unchanged M1B |93/93|93/93|93/93|
| New S01 ownership/fault controls |15/15|15/15|15/15|
| Strict positive leaf types |pass|pass|pass|
| Removed-directive negative types |4 expected diagnostics|4 expected diagnostics|4 expected diagnostics|

One actual strict production build, full offline pack/install with scripts disabled, then physical relocation. Every runtime cohort logged223 unique loaded product modules, all matched the candidate full-package hashes; types resolved only that layout's product declarations. No source fallback.

The15 S01 cases comprise second reserve and second Buffer.alloc failure with Error/null/undefined (6), first-reserve refusal (1), later OID/offset/fanout/step failure (4), successful index temporary release (1), actual direct command reserve/allocation propagation (2), and verified catalogue bodies pinned through operation.close until Session.finish (1). Method wrappers observe actual returned Buffer identities and releases, delegating counters unchanged. Buffer.alloc is instrumented only within the selected Session.allocate call and restored in nested finally.

- Loaded original090 compiled pack.js from the authenticated old full tar:7 pass/8 fail. Exact8 failures show the first acquired slot owner never released; injected reason preserved. This is a one-artifact reversion within the new package, not a new whole090 replay.
- Restore exact candidate pack.js:15/15.
- Unreached injection control:7 pass/8 intentional failures, all8 have fired=0. Calibration cannot silently pass without injection.
- Wrong pack.js binding refuses before cases. These four control groups passed their explicit obligations; their intentional red rows are retained in RAW, not product failures or erased history.

## Bounds, capture and ownership

Elapsed40.035s;23 serial direct children (peak1), all closed naturally,0 signals, below20min/32children/peak4. Captured2,806,647 child bytes; actual scratch inventory66,067,821 bytes below64MiB capture/512MiB working bounds. Individual30s case/120s child limits were not reached. This is no global descendant census/hard kernel-drain guarantee.

Retained root: /var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/git-m1b-s01-author-w18qw5.100 top-level raw descriptors;98 embedded, exact source blob stdout separately bound by282 source identities and full tar separately included. Encoded RAW.json.gz.base64 SHA256 e283f5e9e5be67cd8b68b3d6360d8139a2af8f1e8bee1175bc8412cc70bbb713. All original roots/captures remain untouched.

## Qualifications and review handoff

Synthetic fault injection establishes this source unwind behavior, not observed native allocation failure/OOM, physical freeing, RSS, native leaks, or public fixed-cap reachability. Catalogue pinning proof is a finite buffer-ownership observation; it does not complete38format/32resource108variants or all lifecycle obligations. S02 writer-error provenance remains a separate unexecuted concern. No source change was made to quiet Dirac's unqualified H09 289/288 observer.

Historical source09029163,663/12 and699 author results are preserved, not rescored. New699 unchanged regression passes and45 new ownership cases are separate cohorts. Six native workflows remain UNRUN.

Sagan: authenticate SOURCE/EXECUTOR/whole tar; inspect the one-source delta and whole compiled source-bound wrappers, actual original-artifact reversion events, exact restored artifact, no-cap-change proof and pinned-lifetime case. Independent acceptance and exports/default integration remain pending.
