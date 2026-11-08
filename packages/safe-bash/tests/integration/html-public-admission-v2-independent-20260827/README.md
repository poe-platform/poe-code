# HTML74 admission-v2 independent review — BLOCKED

Date: August 27, 2026. Fresh independent verifier leaf; all review and verification
performed directly, without delegation. Candidate remains exactly
`aff899aa94ed0c57a936b08fd36d185688f5c0bb`. The author seal is authenticated against
commit `aa4374b0ab5f0789e51026b7c6fe163c044a9a6c`.

**Do not authorize actual34 next.** The single independent35-control run had
**34 passes and one failure**. Later phases stopped; no admission build,
full-pack reproduction, extra four controls or reconstruction was executed here.
Actual34 runtime cases remain **0**. This is neither public acceptance nor a gate.

## Genuine finding: independent RSS control fails

`tests/integration/html-public-independent-20260827/admission-v2/controls.mjs:81`
fails the existing positive >1GiB control's exact assertion:
`assert.ok(result.maxRssBytes < 256 * 1024 ** 2)`.

Raw evidence is `execution/controls/031-over1GiB-positive-backpressure.json`.
Its SHA256 is
`6d2aba2efd55e0c1466a5e94e52d1af60e89db8d8f35af3dd5c1e8c0be40baf3`.
The control completed its stream/hash, producer-drain, consumer-concurrency and
chunk-bound checks before that assertion. The exact sampled RSS number is **not
retained**: the entrypoint returns those metrics only after the failed assertion
at line82. Do not invent a peak or classify this as an established unbounded leak
or product failure. It is a genuine admission-control reproducibility failure.
No budget, assertion, author implementation or frozen expectation was changed.
No control was retried. Cohost load was not isolated or measured.

The existing suite catches control failures and finishes its own remaining
controls; it reported35 executed,34 passed,1 failed and exited1 naturally.
The separate supervisor then stopped without launching another phase. The
four other >1GiB negatives correctly rejected wrong SHA, truncation, hard limit
and child exit7. Their expected failures are passes, unlike the RSS assertion.

**Action for root:** route this exact raw failure, frozen tooling/environment and
the missing numeric metric to the author for bounded investigation. Any revised
verifier needs new explicit authorization/binding and different-agent review;
do not increase limits or replay until a pass. Independent full materialization,
build/package reproduction and reconstruction still need completion before
reconsidering authorization of actual34.

## Independently established

- All108 author files (107 SEAL-covered files plus SEAL itself) match the exact
  sealed commit, Git blob/mode and SHA256. Before/after recursive file checks
  detect new files and symlinks, not new empty directories.
- All user handoff digests match: SEAL, BINDINGS, original runner, v2 runner,
  core, complete410 selection, retained author package bytes and whole archive.
  `PRE.json` carries the exact values; this authenticates old pack bytes, **not
  a new compiler or package execution**.
- Independently streamed the entire2,340,945,920-byte pristine archive before
  and after controls, each SHA256
  `cb7f6b6d68f5946c3300e28156367ba42d1af83b12cb1b4be88832c50dfbfd07`.
  No multi-GB readFile/spawnSync buffering, archive file or archive extraction.
  Both streams exited0, without signal, timeout or stderr; close was awaited.
- Direct static review found no other concrete defect in stream/path/link/hash,
  materialization, binding, reconstruction or full-pack admission logic. The
  positive RSS behavior supersedes the provisional static-only disposition in
  `STATIC-REVIEW.md`; static acceptability did not imply successful execution.
- The metadata control validates36,351 entries,12 authenticated historical links
  and the complete410 selected set. Link targets remain metadata; none of those12
  was followed/materialized. The synthetic dangling link is a separate control.
- Original18 frozen fixture files/runner and all15 DU75 files at freeze1bd1048b
  retain exact identities. Three author development failures remain sealed.
  Protected inputs and bound tools/helpers are unchanged post-run.

## Explicitly not independently executed

The four extra materializer/reconstructor controls, authenticated410-file positive
materialization, TypeScript config/listing/build, npm pack/full830-file reproduction
(828 dist files) and scoped reconstruction are **unexecuted**, not passes.
The 35-control run invoked the missing-input negative materializer, which rejects
before acquisition; that is not successful positive materialization.

Author-only claims remain39/39 controls,65,377,928 materialized bytes,207 source TS
plus166 tool/type inputs,830 package files/828 dist and pack SHA256
`d9c1a97388357c5cb0c810cf2fa5181dc7bebff49efe517db414a5833096eed7`.
Old retained pack bytes authenticate to that hash; independent reproduction is0.
The full410 record-list hash is
`1886e217c0cf4c9f4a9c7a19a9d747fbb06660f6e201530785975cdec200c257`;
it is separate from both the archive and253-entry author envelope.

Direct Git metadata independently confirms the exact direct-parent delta is TWO
paths, not14: `lifecycle.ts.fixture` and `verify-public.mjs` under
`tests/plugins/html-to-markdown-public-author/`. Parent is
`b983a37fa8bc322d707867afa9250f88fb408e0a`. The inspected reconstruction is scoped,
not a full clone/history fsck/archive proof. No reconstruction was run here.

## Settlement, concurrency and qualifications

Helpers, supervisor, tool binaries/trees and inputs were hash-bound before
execution (`EXECUTION-FREEZE.json`). No adapter/source overlay was used: original
entrypoints, explicit output paths and owned TMPDIR/HOME only. The controls process
closed naturally; supervisor sent no signal, and both post-close and settlement
process-group censuses found no surviving members. The deliberate hard-limit
negative caused the verifier's expected child SIGTERM; it is not a supervisor
timeout or silent success. Owned scratch was inventoried, compressed with a
roundtrip/hash receipt, then removed. No author/foreign scratch was removed.

The original whole-index postcheck detected concurrent commits and stopped. Its
failure remains raw. `POST-RECONCILIATION.json` identifies the original clean index
exactly as9cccda89, authenticates the later committed index and records foreign
changes with no protected-path changes. No reset, stash or foreign staging
mutation occurred. Unrelated commits neither enter nor veto the immutable archive.
This is **not** an unchanged-global-index claim.

The original rejection raw log is **MISSING from the authenticated available52
author captures**, unrecovered and not synthesized. The new frozen-inventory
rejection stays explicitly synthetic; the unsafe original runner was not launched.
Author binding-01/02/03 development failures, original18 files and original code
remain intact. Earlier257 tests/8 moved programs stay author-only, not rerun here.

Reviewer-only preflight mistakes and the failed overly strict index check are
preserved in `REVIEWER-DEVELOPMENT.md`, not concealed as passes. The frozen cleanup
helper's generic pack-retention sentence is inapplicable to this stopped run;
`SETTLEMENT-QUALIFICATION.json` corrects it explicitly. No independent pack exists.

`MANIFEST.json` seals this evidence, including raw stdout/stderr/exits and the
failure. Check integrity only with `node seal-review.mjs check` from this directory;
this does not execute controls or authorize a rerun. The evidence commit and
manifest SHA256 are reported to root after the explicit-owned-path atomic commit.
