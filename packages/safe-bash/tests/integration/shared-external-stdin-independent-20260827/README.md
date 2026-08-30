# Independent shared external stdin: baseline only

**WAITING for an explicit root candidate route. No product edits or candidate
inspection. Revision 2 remains PROVISIONAL pending root/fixture adjudication.**
The read-only verifier succeeds at authenticating retained evidence, not at
accepting this defective baseline or approving a product change.

## Results and provenance

| Cohort | Frozen fixture | Actual result |
| --- | --- | --- |
| Original baseline, attempt 2 | `0ec75ef320ecaea9fc66e1ba952f3961c917685c` | **18/32 assertions pass; 14 failures retained** |
| Original negative controls | Same freeze, after its 32 baseline children | **2/2 detected**, separate from behavior denominator |
| Provisional revision, attempt 3 | `92f7626200d1509cf0efe17e4ee6c3d558f3a277` | **25/35 compatible; ten close-error failures**, not approved |
| Provisional negative controls | Same provisional freeze, after its 35 children | **2/2 detected**, separate from behavior denominator |

Baseline is exactly `eaed12f88365e69597994c4f2e6324a020202b66`, not HEAD.
Author evidence `28f13113fcc57c60f90cf385f33ccc58db580a06` and harness
`8aa4db42a6ff22fabeea9057b7c111f1506490b9` supply historical context only;
their 34 observations/nine defective rows and 63 tests are not added to these
independent denominators or represented as rerun.

`CLASSIFICATION.md` accounts for **every original failing identity**, exact
recorded status/bytes/read/return effects, fixture-layer errors, proposed
corrections, and limits of the original capture. Six original early/unread rows
unambiguously reproduce normal awaited close error loss. Original EOF expectations
were overstrong; ordinary command errors were incorrectly assumed to be selected
public rejections. Those errors are not erased or silently counted as passes.

Attempt 1 retains a loader-root setup defect (`/tmp` versus `/private/tmp`). The
original deferred-EOF child in attempt 2 exits **13** with unsettled top-level
await, not a timeout: its unused return cannot provide the awaited readiness
event. No finally receipt is invented for that child. `ATTEMPTS.md` and
`REFREEZE.md` disclose the provisional fixture changes and three additional
precedence holdouts. Root's later coordination explicitly withholds approval;
no further executable changes followed that instruction.

The compatible scoped rows protect direct handler diagnostics, natural EOF,
exact abort reason 0/Error, late rejection observation, interruption of
unregistered return by disposal, opaque generator non-retirement, shared binary
stdin through literal nested invocation, active sibling isolation, and explicit
cooperative host/VFS cleanup delaying normal and disposal settlement. This is
not universal stream/adapter acceptance or a broad release gate.

## Actual package authentication

Every attempt archives **227 exact committed source/config/document files**,
authenticates **247 copied development-tool files**, compiles the archived
production source, runs real `npm pack --ignore-scripts`, extracts, then **moves**
the package into a separate consumer's `node_modules/virtual-bash`. Tests import
the actual public package, not a source alias or live dist. No dependency install,
runtime dependency, source mutation, native oracle, performance test or server
is used. The two executed cohorts each load **176 authenticated modules per
child**, totaling **12,496 loaded-byte receipts** including negative controls.

- Source archive SHA256: `8835f819b7763df980ca9f66b329e5736451377bb03cef3f1d3950d11783e333`.
- npm tarball SHA256: `58d26ef0a4b92a1bc808851ba56a1fc42893c8c53a658d004893a6e3422b1320`.
- Baseline input source SHA256: `7af2dac6dfd6290e9f189590e9190b2e0703dcd99998212e471378063cd9a7b4`.
- Compiled/actually loaded input SHA256: `dfae555acaa51838dba66b81da380c0cd235bc3e0b3c784ea63b888404feb331`.

All three builds yield the same tarball digest. Authentication includes Git blob
IDs, exact runtime/npm identities, pack integrity/file list, tool/build/package
manifests and load receipts. Before/after comparisons include **new directory
entries**, modes, sizes and bytes—not only originally tracked files. The setup
failure has no successful post-execution integrity assertion; the two full
cohorts do. Native Node is Darwin arm64 v22.22.2, not the author's Node24 profile.

All behavior/control children use `--unhandled-rejections=strict`. Readiness gates
and event-loop checkpoints drive cases. Parent hard watchdog is 60 seconds per
probe, 180 seconds per build/pack command; **zero expiries and zero waivers**.
The watchdog targets only its exact child PID and awaits closure. Ordinary cases
have no unhandled-rejection crash; the deliberately unobserved late-return fork
exits 1, proving the strict negative control is live. Bad-swallow deliberately
fails the existing benign direct deferred-return expectation. Neither control
edits product bytes.

## Evidence and cleanup

`SEAL.json` authenticates **171 preserved raw evidence/reference files**. All
original captures are copied byte-for-byte; exact runner and fixture sources are
included as data. `verify.mjs` is read-only, checks the seal including added
entries, Git source binding, moved-package loaded bytes and before/after hashes.
It never rewrites canonical evidence or reclassifies failures.

```sh
node tests/integration/shared-external-stdin-independent-20260827/verify.mjs
```

Runner at `7b983a73` binds the provisional fixture at `92f76262`; the runner
present in the earlier fixture commit was historical, not the one used for
attempt 3. Replaying it requires a new unique scratch destination and does not
confer adjudication approval. `seal.mjs` intentionally refuses an existing
evidence directory; do not rerun it over this capture.

All exact owned children closed. A final process-table check found **zero active
owned scratch processes**. Probes create no servers or descendants. Inert unique
temporary archives remain for audit; nothing was broadly deleted. Foreign edits,
staging, native artifacts, sort/performance work and the separately assigned
`fixture-adjudication/` subtree are untouched. Actual bounded work only is claimed,
not 72 hours, broad parity, superiority, or completion of the product.
