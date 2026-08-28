# DU75 admission repair v3: build/pack proof only; DU29 HELD

The single authorized attempt completed with
`ADMISSION-BUILD-PROOF-ONLY-public29-HELD`, without retry or post-freeze
recipe changes. Recipe commit:
`436173fcec6787f17f167e03a3b789bf6485e9e5`.
Recipe manifest SHA-256:
`1ca6554a66e0c4160dca6da399229208719f8721ad19331b3daa30fd8c5afa79`.
Raw run manifest SHA-256:
`2528124ae7a9d099af2f448c3e55d9142fcc25beac70caa1c3773d1e37858e48`.

## Concrete results

- Focused negative controls: **6/6 rejected**, separately counted N01–N06:
  unlisted input, fresh new directory, mode, hash, metadata-only AGENTS,
  actual fresh symlink. No AGENTS file was materialized/read for proof.
- Original registry: **11 definitions preserved; 9/9 applicable passed**
  admission guard checks, comprising 54 original negative mutations plus
  S01/A01/A07 admission observations. A06 and P03 remain HELD, unexecuted,
  with no pass. These are not nine DU semantic passes.
- **771/771** selected Git entries authenticated and materialized. Complete
  selected-set and per-blob mode/hash authentication ran before and after.
  Candidate `0895de2dc63014989f23912c3d48f7c4d0d35a47`, tree
  `0d6fe4cc764e047c0f4c9eb93cfaa3824be36965`, source
  `b2b4604f09f351d8130c0f2a3349e85f4b4c45e1` remained pinned. Inventory digest:
  `c0f955c78776711e6d12d05a45c91326318ae6f8b4ce774d7f87fd6d82e57dbe`.
- Independent compiler output matched **832 dist files**. Full package
  census matched **834 members**. All **726,693 whole-tgz bytes** directly
  equaled the reauthenticated author artifact; SHA-256:
  `4d4d071a0142ac950240f7c3aaacd5283777143d70cc2e3c245ba199fdd01c7d`.
- Full unchanged tool closure: **2,274 regular files and 12 metadata-only
  aliases**: npm 10.9.7 (2,027 + 12 aliases), TypeScript 5.9.3 (132),
  @types/node 22.20.1 (74), undici-types 6.21.0 (41). No alias was followed
  for materialization. Each alias target hash came from its separately
  enumerated regular-file binding. Closure verification is not load proof.
- Actual CommonJS compile proof: build **3 unique module paths / 3 compiles**,
  pack **541 unique module paths / 541 compiles**. Observed file-read records:
  build 383, pack 561. Entry and clean exit observed for both; every compile
  input matched its bound tool bytes. **Product JS module compiles: 0**.
  Compiler TS reads do not approve product behavior or the private helper.
- All six normal POST audits passed: protected 37 and recipes; full tool
  closure; complete pinned Git selection; author pack; fresh staged tools;
  complete fresh candidate. Fresh tree comparisons include file/directory
  names, recorded modes, types and file hashes, rejecting unknown additions.
- **2,966/2,966 children naturally closed**, including 2,964 Git children
  (81 launcher Git children included) and two tools. No watchdog fires,
  signals, active children, normal failures or cleanup failures. Scratch
  removed; compact authenticated-input archive and raw receipts retained.
- Attempt elapsed **30,161 ms**, from August 28, 2026 00:04:05.283 UTC to
  00:04:35.444 UTC (August 27 local America/Chicago). Peak observed owned
  disk bytes 58,843,478; peak child output bytes 93,950. These are bounded
  supervisor observations, not RSS measurements or performance comparisons.

## Preservation and qualification

Standalone post-run sealing independently rechecked all **37 historical
files**, the six newly committed recipe files, exact recipe commit additions,
and the 25-file raw run namespace against its manifest. This is separate
from the normal attempt's successful PRE/POST qualification. It does not
assert that the concurrent owner-root namespace or global index is unchanged.

The original failure at `b0a7b441f51a36fd279a579f73dd36b96588b8e9` remains
immutable: 0 applicable controls, 0/771 inputs, 21 natural Git child closures,
AGENTS name rejection before content, and complete planned PRE/POST FAILED.
Its exact rejected pathname remains NOT RETAINED. No search, guess,
reconstruction, rerun or rescore occurred; historical missing paths stay
missing/unqualified rather than becoming repaired obligations by relabeling.

The new proof is only the declared `scoped-committed-archive` Git-blob
selection plus protected files and explicit tool closure. It is not whole
live-checkout/full-history proof, a new product integration, full fixture
typechecking, whole-gate acceptance, or superiority evidence. Node builtins,
OS/kernel and shared libraries remain explicit host trust. Existing failed
recipes, original definitions and all product/root configuration remain
unchanged.

## Remaining holds

**A06, P03 and DU29 remain HELD/unexecuted; zero DU cases ran.** No public
install/move/load/type/29 replay, author 166-case cohort, native/metadata/RSS,
HTML74, other cohort or private-helper behavior acceptance ran. Previous DU9
and native evidence remain module-only, unrerun and unrescored. Remaining
blocker: accepted HTML74 plus separately authenticated public executor/root
eligibility. A matching build/pack does not supply either authorization.

Raw results: `run-v3/RESULT.json`; receipts and exact namespace:
`run-v3/EVIDENCE-MANIFEST.json`. Standalone seal checks:
`post-run-v3-bindings.json`. The additive evidence manifest binds this outcome,
the standalone checks and all 25 raw files, excluding only itself.
