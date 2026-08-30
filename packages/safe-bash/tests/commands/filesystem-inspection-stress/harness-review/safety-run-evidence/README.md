# Authorized original run: four passes, two HOLDs

This is the additive execution receipt after the historical prepared-only seal
in commit `2070378359e479e7b589d46705d4275181ae0ad2`. Original/v1 artifacts and
earlier HOLD/findings remain untouched. No full38/full40 cohort is represented.

Root approved SHA256
`e4d048afb4784f802047de589212519465bb7589ccdb99e10ba677add39cee1c`, which differs
from original proposal `4f096db838c296579e52811c5d3a349cd0ecdae0278fe4045219e895c205c11f`
only in its approval marker. Both original invalidated proofs remain unchanged.
The snapshot is candidate `436bda3e21b2b6041409fac7408cf072b5d3fe5e`; the separate
proof confirms file bytes equal baseline `cd37ce07c1f41f3797e19e0f701b662823338843`.
All920 authorized snapshot hashes and unchanged original runtime seal verified
before the single run. No source/compiler payload is included here; provenance
records names, hashes, accounting and the other leaf's build history only.

## Exact invocation, once

```sh
node tests/commands/filesystem-inspection-stress/harness-review/safety-v1/run.mjs --execute /tmp/safe-bash-inspection-safety-root-approved.json e4d048afb4784f802047de589212519465bb7589ccdb99e10ba677add39cee1c /tmp/safe-bash-inspection-safety-original-run-20260827-01
```

Controller start/end: `2026-08-27T09:36:27.714Z` / `2026-08-27T09:36:28.249Z`.
Elapsed time is bookkeeping, not a performance assertion. Controller exit1
preserves two HOLD rows; it does not mean four product failures or six passes.

| Row | Outcome | New commands | Shell status | stdout/stderr bytes |
| --- | --- | ---: | ---: | ---: |
| T-empty-many | pass | 1 | 0 | 8262/0 |
| T-DP-cumulative | HOLD | 0 | not run | not run |
| T-sort-many | HOLD | 0 | not run | not run |
| F-JSON-cumulative | pass | 1 | 1 | 29/26 |
| F-header-many | pass, classification only | 1 | 0 | 1192/0 |
| F-metadata-many | pass, first admission rejection | 1 | 1 | 0/28 |

Four children started, four actual commands dispatched, four normal child close
events (code0/no signal), four Shell disposals. Zero mutation/unhandled rejection,
unknown partial outcomes, retries or native-oracle calls. Heap limit per child
134217728 bytes; maximum cooperatively observed RSS81477632 bytes. Every child
was below the256MiB observed stop and64KiB combined capture cap. Child/batch
watchdogs remained5s/30s; no timing threshold is used as a semantic assertion.

The JSON case consumed two8190-byte streams (next9 each, return0, both exhausted)
and classified only the first before the second sample work admission failed.
Header classification consumed32 distinct512-byte streams (next5 each, return0)
with no claim of valid formats/security certification. Metadata reached one
lstat/readlink, no content read, and emitted the28-byte output-limit diagnostic.
The original empty-alternative case retained all64 names and exact output.
Producer return0 here means normal exhaustion, not skipped early cleanup.

Each child's448-byte transport stderr is the preserved Node experimental-loader
warning, separate from product stderr; no product assertion was relaxed for it.
Module logs contain25 loads for tree and21 for each file child; each recorded
hash is in the root-approved manifest. These counts are observed loads, not the
static28-module union closure or proof of all product modules.

## Evidence and next boundary

`MANIFEST.json` binds26 byte-identical copied proof/provenance/raw-run artifacts.
The raw summary SHA256 is
`67eb07af4da1452bce7f7751882d4ed6195fbf91aee016510850f3bc8dcd4465`.
No stdout/stderr bytes or raw row statuses were rewritten. The original four
results can be reused by hash, never silently rerun in the derived phase.

`../safety-v2/` prepares only the root-permitted two-row correction. Both remain
UNEXECUTED, with no root authorization. Independent review and a new explicit
root-approved hash are required before at most two additional commands. This
directory and the derived proposal are uncommitted pending root's next step.
