# Compact manifest repair — bounded preparation checkpoint

## Frozen source and one qualification

- Source/preseal commit: `5bba15291a009b88bf35bc1c04974acf8a5d525e`.
- CONTROL-PRESEAL SHA256:
  `27198bc6cb3b6289ad871fe29e4db183fa10ab54a84c1ba795e041f1c1f8a176`.
- One DATA/SYNTHETIC attempt: **22/23 PASS, D02 FAIL**. No retry or changed
  expectations. The control fixture's expected overlay count 10 remains frozen.
- Owner PID 96580 / child PID 96581; total and subject peak 2; child natural exit
  1, close observed, exact child PID absent. Duration 18,408 ms. All 2,399 observed
  stdout/stderr bytes retained; stderr empty. No product evaluation or build.
- All 30 source/data preseal members unchanged in the postguard. The eight
  retained qualification artifact files total 1,016,870 bytes; each has an exact
  size/mode/hash in EVIDENCE-MEMBERSHIP.json. Retained inert fixtures are evidence,
  not active test services or reusable product staging.

This is not an all-green qualification or an actual-review admission seal.
CONTROL-PRESEAL binds the finite controls and component bodies, not authority to
run the 54-job controller. No ROOT-GO.json or actual PRESEAL.json is issued here.

## Measured representation result

D01 round-trips the committed **22,330,550-byte historical runtime manifest** to
a **1,013,387-byte** canonical packet with 37 authenticated catalogs and back to
the complete original data. It preserves 882 package files, 274 source-input
rows, 30 physical variant graphs, and 51 runtime-job entries. D03 separately
round-trips all 36 jobs carrying runtime job bodies through the same codec.

Normalized DATA SHA256:
`da0ff9218961296cb21bbc127145dba12b60d3f9cec5d3e595b83af56e92438e`.

The complete artifact is retained at
`qualification-01/scratch/NORMALIZED-HISTORICAL.json`, not replaced by a summary.
It contains the *historical* physical consumer paths and is not runnable staging.
It is a representation of committed DATA, **not reconstruction of missing raw
Git stdout**. Neither original capture loss is repaired or rescored.

The historical three-object batch, with this DATA representation, measures
**1,061,192 framed bytes**, including all headers and payload-final LF bytes.
The 16,777,216-byte administrative/parser cap is unchanged. Minus/at/plus JSON
and full-frame endpoints passed; above-cap serialization refused before any
Buffer.from call in that scalar control. This does not claim no allocations
anywhere in the codec or a hard RSS bound.

## D02 exact failure adjudication

D02 first compares all 30 reconstructed graph records against the historical
records. Those assertions complete. Its final independent expectation asks for
10 distinct overlay bodies and observes **30**, so the case fails.

POSTGUARD-AND-DIAGNOSIS.json preserves the 30 immutable variant IDs and complete
binding objects: there are 30 distinct binding objects, not 10. The generator
places phase-specific witness markers into before/mutant/restored bodies;
`variants.mjs` lines 43–47 explicitly form IDs from family and phase and hash
each changed body. Ten logical families do not imply ten byte-identical overlays.

This is a fixture-count diagnosis backed by immutable variant metadata, not a
new passing execution. The proposed versioned correction is only the final
distinct-overlay count 10 to 30, preserving all prior graph equality assertions.
It has **not** been applied or rerun. Independent review should adjudicate it.

## What is implemented and what is not yet qualified

The versioned codec uses internal content-hash references, exact catalog fields,
unique ordered records, canonical JSON, complete package/input authority hashes,
and finite one-base variant overlays. The passing controls reject missing,
duplicate, corrupt, external, unused, cyclic-base, wrong-mode, unbound-path,
wrong-result, noncanonical and truncated forms. Cross-realm validation uses
own-data checks and canonical values rather than prototype identity.

The actual versioned loader body consumes a decoded packet in the stub control:
one inert evaluation and three refusals (wrong authority, wrong file hash,
unbound import). This is **not** a complete physical 882-file product load or
dynamic proof of the actual bootstrap/controller. The stub stages only inert
files; missing physical product files are not credited as loaded.

SOURCE review identifies two additional integration constraints, not dynamically
proven bypasses and not product findings:

1. The controller measures/reserves the complete normalized Git batch before
   serializing/publishing RUNTIME-SEAL and checks exact Git --batch-check sizes
   before fetching objects. However BUILD-RECEIPT is published immediately
   *before* that combined reservation. Move its construction into bounded
   measurement, reserve both bodies plus commit framing, and publish neither
   until the combined admission succeeds. Current controls do not execute that
   controller publication path, so they do not close this requirement.
2. `decode` allows generic full inventories for source/consumer catalogs. The
   same `resolve` branch is used for graph `manifest` references. Tighten graph
   manifests to the fixed package catalog or its approved finite overlays,
   while retaining generic catalogs for sourceBefore/sourceAfter/consumers.
   The existing full-package authority and outer job hash binding are not a
   substitute for a graph-position completeness check. Freeze a coherent
   shortened-but-content-addressed graph counterexample before the next run.

No sealed source was edited after the qualification. These constraints remain
open; do not grant actual execution from the 22 passing controls alone.

## Proposed next actual profile — not authorized here

Use a **fresh full54** setup/build/review, not reuse of the old three setup jobs:
the old scratch was removed and new job/consumer bytes and hashes must be sealed.
JOBS.json preserves the complete original 54 groups, including original32+80,
the versioned diagnostic/observer rows, U01–U12 and I01–I04 S54 work, types,
adapters, limits, activated mutants and restores. No old product passes inherit.

Candidate remains `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`, derived tree
`6a59ca403c5411344dea2ee057909ba179bf7043`, full882 package SHA256
`f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`.
Package catalog ID is
`e312788eff19011dc46d65a750737ecc9318f504b5c3bdfc8f6c56b25991588e`;
274-input catalog ID is
`144a9477339dd3e50a17a58bf3f076438a0327dd1dfe0b778843f72829165557`.

Proposed actual bounds remain 110 minutes including cleanup, 70 all-owned
processes, peak4 total, 128 MiB combined capture, 512 MiB work, case30s/build120s.
One extra serialized Git --batch-check administrative process must be included
within 70, not added outside the budget. No capacity-fit guarantee for the 51
unrun jobs is inferred from DATA compression. Remaining actual admission work:
resolve the source constraints, review the precise fixture delta, freeze the
complete executable membership/launch interface, then obtain ROOT actual GO.

## Preparation accounting and preserved history

Preparation started 2026-08-28T23:09:08.759Z with the fresh 20-minute/32-process,
peak4/64-MiB-capture/256-MiB-work envelope. The planned finish uses 30 owned
process admissions including the one qualification child; terminal exec replaces
the launcher shell. Qualification's two-process peak is measured by its owner;
source/Git/editor calls are serial tool admissions, not product calls. The raw
qualification accounting is exact; earlier tool-rendered source inspections are
not relabeled as complete raw captures. No native editing executable was read.

The AGENTS durable inspection rule is included in the source commit. Necessary
Node tool identity was obtained by a bounded 64-KiB streaming hash; apply_patch
is only used through its interface and is absent from executor input bindings.

Original `685cdd0d` remains consumed HOLD3/54/51 unrun, with 131,072 irrecoverable
unretained observed bytes. Original `5f336d1a` remains binary-output HOLD with
380,995,389 tool-reported omitted bytes, exact raw counts unknown, zero product
or qualification. Neither record was changed or reconstructed.
