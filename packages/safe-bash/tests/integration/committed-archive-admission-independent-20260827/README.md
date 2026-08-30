# Committed-archive admission — independent review preparation

**Status: prepared; new mode not yet handed off or reviewed.** Root permits
explicit committed-clean-archive admission for the fixed candidate while a
separate live checkout changes. This is not permission for a global dirty-guard
bypass, source overlay or implicit source fallback.

## Fixed inputs

- Candidate: `8670ebe8f0d39966c2de2638780437398e5f8490`.
- Existing admission package:98843c59; preserved refusal:86c63b39.
- Policy:3,246 code/config inputs and560 exact canonical test paths.
- Cleanup:220 inputs; compact SHA256
  `d9309d27efd2e1e418f075f4f514efeeefa833e8b3dc5e061662289f8ecd67b6`.
-49 mandatory native assets remain required. Neither this preparation nor their
  availability is a whole-gate pass or admission of an unreviewed new mode.

`prepare.mjs` reads fixed Git objects, validates policy scope paths/modes/blobs,
checks the exact canonical set, and authenticates every cleanup hash against
its actual candidate blob with Git batch reads. It authenticates the original
11-control preparation and original dirty-rg refusal without rewriting either.
It invokes only the existing pure admission assessment from a regular temporary
copy of the pinned helper. That assessment reads live Git **status metadata** and
native asset bytes; it does not copy or evaluate live product source. The real
Faraday edit is not used to construct a candidate, changed, staged or removed.

The preparation observation is deliberately separate from86c63b39: the later
strict check reports a live edit to the admission runner itself, not the earlier
rg edit. Both observations retain their actual paths. This moving checkout does
not alter the frozen8670 inputs; it also does not constitute new archive-mode
acceptance before that mode has been handed off.

No source archive is extracted, compiler/build/product suite launched, native
binary executed or private engine accessed during preparation. The helper's
temporary files are removed. The existing strict refusal remains meaningful
evidence and must continue to work in strict-live mode after the new feature.

## Prepared bounded review

`guard-cases.json` freezes18 review cases, all explicitly **pending**, with no
invented mode flag. Reuse the existing successor11 preparation controls and
shared preflight tests, plus small owned Git/archive fixtures and import/phase
sentinels. The already accepted native148/280 matrix is not rerun wholesale
unless a changed native branch makes that necessary.

Required distinction:

- **Strict-live:** the unchanged dirty-check contract still rejects relevant
  live edits. Invalid/unspecified mode must not accidentally bypass it.
- **Explicit archive:** authenticate the full selected commit/tree/blob input
  set and required modes in the actual isolated candidate. Unrelated edits or
  untracked files in the source checkout neither veto that clean archive nor
  enter it. Do not use current HEAD, live copied files or stale dist.

Predeclared negative cases cover changed/missing source/test/package inputs,
wrong-commit archives, foreign overlays, active-file/parent symlink escapes,
and post-phase mutations. Keep exact cleanup provenance/environment and native
guards. Planned mutation controls detect blanket dirty bypass, dropped archive
byte validation and accidental copying from the live checkout. These are
trusted harness/isolation checks, not arbitrary-host-JavaScript sandbox claims.

Committed literal symlinks used as fixture data are not silently outlawed;
required active-source escapes are denied. Authenticated native/tool staging and
fresh generated build outputs must be explicitly distinguished from an input
overlay, not used to excuse arbitrary extra source/configuration.

## Needed author handoff

Root should relay **the exact new author source commit and evidence commit**, the
explicit mode flag/API, and the bounded admission test command or sentinel seam.
Also identify which shared helper/runner files changed and how allowed generated
outputs are separated from the immutable source capsule. Candidate8670 remains
fixed unless root explicitly changes it. No new-mode source acceptance or test
count is claimed before that handoff; no polling or duplicate implementation.

```sh
node tests/integration/committed-archive-admission-independent-20260827/prepare.mjs /tmp/NEW-PREP-REPORT.json
node tests/integration/committed-archive-admission-independent-20260827/verify.mjs
```

The first command performs only the bounded preparation described here. The
second authenticates its committed evidence. Neither launches the whole gate.
