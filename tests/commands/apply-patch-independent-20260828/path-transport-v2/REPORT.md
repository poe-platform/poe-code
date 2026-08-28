# Path transport v2 — DATA PASS, future runtime HOLD

August 28, 2026. Substantive repair leaf; only this new directory is owned.
Source/preseal commit: `d8cbb7d76459e14d20f57e19f7c01ce04fa08702`.
All repair inputs, raw98 inventory, constructed corruptions, expected65 controls,
independent comparator and future execution seal were committed BEFORE DATA
authentication. `runs/data-01/` is the sole repaired DATA attempt: 65 PASS, 0 FAIL.
There are no failed repaired DATA attempts to suppress. No runtime controller ran.

## Exact identities and counts

| Item | Result |
| --- | --- |
| Candidate | `58be2d6c5706f3e90f01d48e695ecfd9daa52669` |
| Evidence | `767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5` |
| Full candidate census | 50,002 paths, including all exact98 formerly C-quoted names |
| Full base census | 37,412 paths |
| Selected materialization recipe | unchanged268 base + six candidate =274 files; NOT materialized |
| Both candidate tree algorithms | `189bef24a927241d7c47a662f1ac447b56da1835` |
| Authenticated stored tree / fresh Git oracle | same exact189bef identity |
| Five-override derived base composition | `8437e4eda904e1248c25eeef0d9d455b1d251495` |
| Derived composition plus six candidate files | `f761c0e1d7a1df48236da38ad78a18cf00a4813c` |
| Future package requirement | unchanged882 files; no build/package acceptance claimed |

The firstTAB/NUL byte parser and independent bottom-up comparator agree on the
COMPLETE census. The stored candidate commit itself and raw root tree bytes are
SHA1 authenticated. Base/evidence commits are authenticated too. Derived-only
composition identities are recomputed, not demanded as stored Git objects.
No filtering98, no C-quote decoding, trimming, normalization or lossy pathname
conversion is used. Full census and selected source projection are separate.

## Reachable consumer repair

`freeze-inventory.mjs` replaces old display-based metadata capture. `path-bytes.mjs`
replaces both controller path parsers, canonical tree hashing, projection validation
and exact batch-object admission. Blob fetch requests use validated OIDs instead
of revision:path lines, so arbitrary pathname bytes never enter line framing.
`capture-io.mjs` verifies raw ordered fragments, lengths, channel hashes, exit and
known child cleanup. The supervisor adds lossless stderr base64 to the original
qualified machinery. `data-controls.mjs` and `independent-tree.mjs` replace the
old display-decoding forensic route. Historical admission/matrix capture/check
scripts and actual-v1 capture/controller/forensics are not executable dependencies.

The future `controller.mjs` is the narrow actual-v1 successor, not a new generic
runner. Its worker, bootstrap, loader, guard control and deadline are exact-byte
copies. All frozen32 originals,80 adversarial rows,94 expanded variants, limits,
known gaps, source-only concerns, diagnostics and policies remain unchanged.
No new product finding is inferred from a harness transport repair.

## DATA evidence and limits

- 35 path vectors: 13 accepted exact-byte cases,22 rejected malformed/conflicting
  cases. Coverage includes spaces/TAB/LF/CR, quotes/backslashes, nonASCII, BOM,
  NFC/NFD distinction, all admitted modes and canonical Git directory sorting.
- Seven object/OID controls; six projection corruption refusals; nine constructed
  capture corruption refusals; eight census/tree/composition/oracle controls.
  Total65 DATA/SYNTHETIC PASS. Refusal controls are not product semantic passes.
- Six serial metadata inventory children and two DATA metadata children: all
  exit0, close observed, owned process groups absent and records retired.
  Peak2 including coordinator; zero remaining known child handles/resources.
- Raw captured bytes:13,251,587 inventory +36,985 DATA =13,288,572 bytes.
  All persisted owned files before this report:18,296,555 bytes. The separate
  delivery inventory includes the report and exact evidence byte/hash census.
  Everything fits capture128MiB/work512MiB; no cap was raised. These are admission
  accounting, not OS quotas or RSS claims. No product work tree exists.
- Inventory Git window18:08:38.066Z–18:08:38.635Z; DATA monotonic checkpoint
  2035.279958ms. These are measured phase windows, not an end-to-end work-duration
  or72-hour claim. Metadata child10s / total repair30min limits were retained.
- Post-DATA check rehashed all276 presealed bindings. Inventory append census
  also checks exact names, so additions are detected there; runs/report are
  deliberately separate additive evidence. No claim to police foreign live work.
- No candidate compile/build/import/install/runtime/mutant/nativeCodex/network;
  no instructions plaintext, git archive or product-source blob snapshot.
  Tools and metadata capture exact bytes/hashes/exit/cleanup are bound.

## Future seal and authorization

Execution seal SHA256:
`c05afd4ca977cc32e81d0ea4cff9311b44e6475a72c54ebf7bcdba7f47a2b116`.

**HOLD until independent review and FRESH ROOT GO. One future attempt only.**
Root must create `ROOT-GO.json` containing authorization `FRESH ROOT GO`, attempt1,
the exact candidate and `sealSha256` above; then the future command is:

`node tests/commands/apply-patch-independent-20260828/path-transport-v2/controller.mjs`

Neither this command nor the old controller was invoked. Unknown emitted-build,
package and loaded-app hashes remain derivation-bound, not invented: unchanged
sealed source/tool/config recipe, complete882 emitted package census, actual
loader/worker/app bindings, committed RUNTIME-SEAL, then RUNTIME-START under the
same original continuous110-minute controller deadline. Original70 jobs and all
child/worker/read-route/permission limits remain. Budget/read-route delta: **none**.

Historical ad08d510 /0297e41c stays original25 DATA /68 NOT_RUN, including the
preserved malformed bd69c tree failure. `matrix/`, `admission-plan/`, `actual-v1/`,
root exports, product sources and foreign staging/work remain untouched. This
DATA success is not runtime admission, package acceptance, parity or superiority.
