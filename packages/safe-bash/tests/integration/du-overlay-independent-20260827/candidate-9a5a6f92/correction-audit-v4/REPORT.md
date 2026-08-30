# DU/Overlay correction closure audit v4

Date: 2026-08-27

## Bounded conclusion

This post-candidate-inspection audit closes the observer-causation ambiguity but
does not make the earlier full-stat purity claim green.

- The exact pre-correction verifier blob
  `f127f231fe53392ed3635af1c255b66526b5c485` is unavailable. The retained
  867078-byte failed output is authentic, but the exact v2-to-v3 source delta
  remains independently unprovable. No approximate reconstruction is retained
  or described as the original.
- Observer-neutral `lstat`-only measurements show that direct Overlay `stat`
  and `lstat` preserve every recorded backing stat field, including `atimeMs`,
  in the executed pending-fixture cases.
- Direct, read-only, and mount-over-overlay `readdir` and DU traversal update
  backing Memory directory access times. Every other stat field remains exact;
  the action windows contain zero mutation calls, zero content reads, and zero
  copy-up signals, and the pending stage remains present.

Therefore the existing corrected verifier proves structural metadata and
content purity only with `atimeMs` excluded. It does not prove full-stat or
atime preservation for directory-listing or DU actions. This is a bounded
finding for the exact cases below, not a whole-gate, parity, performance,
superiority, migration, or project-completion claim.

## Gap 1: exact original verifier binding

`git cat-file` cannot resolve the recorded blob. Full unreachable-object
inspection, all refs and reflogs, and an exact-ID search found no object or byte
source. Three retained later verifier snapshots resolve to blobs
`028118b85a1f3b1c7e926ee76f3354434d8f5e16`,
`1803fd994ad1349b3fe7f5cdc21c4f10378cf90a`, and
`3fdf528c593efbf88b154834291550cce6c81095`; none matches the recorded ID.

Twelve in-memory hash probes applied plausible forms of the two declared
corrections and the later consumer-cleanup insertion/removal. None produced the
recorded Git blob ID, so no probe bytes were saved as original evidence. The
exact attempts and resulting nonmatching hashes are in `blob-recovery.json`.

The old raw capture is unchanged and still verifies as:

- `run.stdout`: 867078 bytes,
  SHA-256 `3fa5f7e7cc3a1bb9133086b06c41ac4f671e562a62192d144e9c800dd9df5e14`;
- `run.stderr`: SHA-256
  `5fa997f91509e743cd70fb5fd20f5a6dffd35bc5e074e0cf8038ec235a4571fe`;
- `run.status.json`: SHA-256
  `93d7432ac47672a3e8d78119710975fa84c477a7db057947787cc24874586082`,
  recording exit status 1;
- literal result: 10 passes and 22 failures in 32 cases.

`FIXTURE_CORRECTION_V3.md` declares that v3 omitted `atimeMs` from structural
snapshots and corrected the retry output. Those semantic declarations do not
substitute for the missing original bytes, especially because the suite also
gained a post-freeze case. An exact byte diff is not provable from available
evidence.

## Gap 2: observer-neutral access-time diagnostic

### Measurement discipline

Each case creates the known refined pending fixture on fresh Memory upper and
lower backings. All backing namespace enumeration and content hashing finish
before the pre-measurement stats. The pre and post snapshots then call only
the backing `lstat` methods over that fixed path list. Between them, only the
named action executes.

Every case crosses a real `Date.now()` millisecond boundary before its action;
the diagnostic does not freeze or patch the product clock. The no-action
control preserves every full stat. The content-read positive control records
one lower `readFile` and changes exactly `/holdout/lower-only.txt` access time,
proving that the measurement detects an access-time update.

Candidate inspection explains the observed distinction. Exact candidate
Memory source SHA-256
`2ece749f3f22be6a0da76dcd964feb9b1055e742a05c727c43f672e9bc7ec8b4`
returns snapshots from `stat`/`lstat` without updating access time, while its
`readdir`, `readFile`, and `readStream` methods assign `Date.now()` to access
time. Overlay SHA-256
`829352e34a662868ddac3385317bf2f7eea8f605ea55e995865a6dd95ddc0d17`
uses backing `readdir` for merged listings. DU SHA-256
`89a7e96bd08f72fd91a140841cf4dd362ba7e741374ec31e476b2db480cbaf03`
uses `lstat` plus `readdir`, not file-content reads.

### Source-build raw results

All actual-action rows have mutation/content/copy-up-signal counts `0/0/0`.
`dir` is the recorded backing `readdir` count. Blank deltas mean every measured
access time was preserved.

| ID | Composition/action | Raw `atimeMs` changes | dir |
| --- | --- | --- | ---: |
| ON-001 | direct / observer-only | none | 0 |
| ON-002 | direct / content-read control | lower `/holdout/lower-only.txt` 1787857663003 -> 1787857663004 | 0 |
| ON-003 | direct / `stat` | none | 0 |
| ON-004 | direct / `lstat` | none | 0 |
| ON-005 | direct / `readdir` | upper `/holdout` 1787857663014 -> 1787857663015; lower `/holdout` 1787857663014 -> 1787857663015 | 2 |
| ON-006 | direct / DU `/holdout` | upper `/holdout` 1787857663016 -> 1787857663018; lower `/holdout` 1787857663016 -> 1787857663018; lower `/holdout/sub` 1787857663016 -> 1787857663018 | 3 |
| ON-007 | direct / DU pending root | upper `/` 1787857663019 -> 1787857663021; upper `/holdout` 1787857663019 -> 1787857663021; lower `/` 1787857663019 -> 1787857663021; lower `/holdout` 1787857663019 -> 1787857663021; lower `/holdout/sub` 1787857663019 -> 1787857663021 | 5 |
| ON-008 | read-only / `readdir` | upper `/holdout` 1787857663022 -> 1787857663023; lower `/holdout` 1787857663022 -> 1787857663023 | 2 |
| ON-009 | read-only / DU `/holdout` | upper `/holdout` 1787857663024 -> 1787857663026; lower `/holdout` 1787857663024 -> 1787857663026; lower `/holdout/sub` 1787857663024 -> 1787857663026 | 3 |
| ON-010 | mount-over-overlay / `readdir` | upper `/holdout` 1787857663027 -> 1787857663029; lower `/holdout` 1787857663027 -> 1787857663029 | 2 |
| ON-011 | mount-over-overlay / DU `/holdout` | upper `/holdout` 1787857663029 -> 1787857663031; lower `/holdout` 1787857663029 -> 1787857663031; lower `/holdout/sub` 1787857663029 -> 1787857663032 | 3 |

ON-002 intentionally records one content read and one conservative copy-up
signal because a lower content read is a copy-up ingredient; it is a detector
control, not an actual metadata/DU action. Its mutation count is zero.

### Moved installed-package raw results

The package binding produces the same preserved/changed case partition and the
same paths and counters:

| ID | Composition/action | Raw `atimeMs` changes | mutation/content/dir/copy-up signal |
| --- | --- | --- | ---: |
| ON-001 | direct / observer-only | none | 0/0/0/0 |
| ON-002 | direct / content-read control | lower `/holdout/lower-only.txt` 1787857663084 -> 1787857663085 | 0/1/0/1 |
| ON-003 | direct / `stat` | none | 0/0/0/0 |
| ON-004 | direct / `lstat` | none | 0/0/0/0 |
| ON-005 | direct / `readdir` | upper `/holdout` 1787857663094 -> 1787857663096; lower `/holdout` 1787857663094 -> 1787857663096 | 0/0/2/0 |
| ON-006 | direct / DU `/holdout` | upper `/holdout` 1787857663096 -> 1787857663098; lower `/holdout` 1787857663096 -> 1787857663098; lower `/holdout/sub` 1787857663096 -> 1787857663099 | 0/0/3/0 |
| ON-007 | direct / DU pending root | upper `/` 1787857663100 -> 1787857663102; upper `/holdout` 1787857663101 -> 1787857663102; lower `/` 1787857663101 -> 1787857663102; lower `/holdout` 1787857663101 -> 1787857663102; lower `/holdout/sub` 1787857663101 -> 1787857663103 | 0/0/5/0 |
| ON-008 | read-only / `readdir` | upper `/holdout` 1787857663103 -> 1787857663105; lower `/holdout` 1787857663103 -> 1787857663105 | 0/0/2/0 |
| ON-009 | read-only / DU `/holdout` | upper `/holdout` 1787857663106 -> 1787857663107; lower `/holdout` 1787857663106 -> 1787857663107; lower `/holdout/sub` 1787857663106 -> 1787857663108 | 0/0/3/0 |
| ON-010 | mount-over-overlay / `readdir` | upper `/holdout` 1787857663109 -> 1787857663110; lower `/holdout` 1787857663109 -> 1787857663110 | 0/0/2/0 |
| ON-011 | mount-over-overlay / DU `/holdout` | upper `/holdout` 1787857663111 -> 1787857663113; lower `/holdout` 1787857663111 -> 1787857663113; lower `/holdout/sub` 1787857663111 -> 1787857663113 | 0/0/3/0 |

Both raw diagnostic files retain every before/after stat field, all fixture
content hashes captured before the pre-stat, exact action calls and counters,
DU output, pending paths, and clock-barrier values. They have no failed
integrity checks. SHA-256 values are:

- source diagnostic:
  `6159da75822160f80facdee18113dab95bf55c76dad0f14dbb4f0232c0fc0373`;
- moved-package diagnostic:
  `3e37eb067e8c0cd39213d0509a6c2028000d92b3452becb806d970a3dcf4a5c8`;
- capture manifest:
  `7f468657d17150a9572ede354be3f593ed7dcdbc2d2cdc335807f2581fa5151c`.

## Candidate and package provenance

The capture selected 241 explicit build inputs from candidate Git metadata.
Before archive creation it enumerated five candidate-tree `AGENTS.md` paths,
selected none, and rejected any selected `AGENTS.md`. The selected archive
contained none after extraction. Every extracted file matched its candidate
Git blob, selected inputs remained unchanged after execution, and the temporary
archive SHA-256 was
`19ed920f7327ecee73bc67b3d3c7bba6bc58804c81a1bf8937aca839c3192626`.

The source build reproduced the previously authenticated standalone DU and
Overlay hashes. Its npm tarball SHA-256 was
`17ea61cadba802e971cdefd545a56c889d28540b378142870cabacab12b67159`,
exactly matching the retained candidate-pack provenance. The consumer was
installed before relocation. All six modules loaded by this diagnostic matched
between the source build and the moved installed package. The prior 789-file
package audit was not repeated. Owned scratch was removed and all child
processes settled.

## Guarantee scope and root decision

For the exact pending fixtures executed here:

- full backing stat preservation is proved for direct Overlay `stat` and
  `lstat`;
- full stat preservation is disproved for the seven executed listing/DU rows;
- all nine actual metadata/DU rows preserve non-atime stat fields, retain the
  pending paths, and perform no mutation, content read, or copy-up signal;
- the old refined-v3 content, copy-up, mutation, and structural controls remain
  separate historical evidence and were not rerun here.

The access-time changes follow candidate Memory's explicit read semantics. This
audit does not silently declare them out of scope and does not repair product
code. Root must choose the normative policy: if the refined requirement means
literal full-stat preservation, the seven listing/DU rows are genuine candidate
failures; if access time is an allowed read effect, the acceptance language
must remain narrowed to non-atime structural/content purity and must not claim
full-stat preservation.

The broader invalid/empty selected `BLOCK_SIZE`/`BLOCKSIZE` fallback question,
as distinct from explicit `DU_BLOCK_SIZE`, remains OPEN. This audit adds no
claim about it.

## Chronology correction

The refined freeze contained 31 cases. The first literal capture had 32 because
the post-freeze DU registered-cleanup actual Shell lifecycle case was already
present; that case appears in the retained failed output. The later
consumer-registered Overlay cleanup control made 33. It was inserted before
several existing cases, so final IDs obscure chronology: the later consumer
control is final `RV3-027`, while the earlier DU lifecycle addition is final
`RV3-033`. Neither extra is claimed as part of the 31-case frozen set.
