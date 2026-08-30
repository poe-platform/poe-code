# Exact attribution, independent archived reproduction

This does not rerun or qualify the whole gate. Its preserved denominator remains
**16,520 pass / 307 fail / 13 skip**, unqualified.

## The writer causes the integrity guard failure

The initial working tree at `954406871fae381b1c69441b34946a224201d7ad` had
foreign untracked changes, recorded in `frozen/baseline.json`, but no tracked or
staged changes. The canonical writer and every direct-curl historical artifact
matched their committed Git blobs and SHA256. No existing mutation was restored.

Before author changes, commit `0c5e2dff39e834fb50048386507a49116b2306fd`
froze ten controls, exact initial bytes, the source inventory, all 99 diagnostic
rows, and losslessly decoded gate snapshots authenticated against its manifest.

The old canonical line 213 unconditionally writes each case's observation into
its tracked `artifacts` directory before assertions. Its later conditional branch
can also write an ambient `/tmp` finding; that branch was not reached here.

A fresh full Git archive of `b494675c34dc289f4ad4b10a9201e1211eb0a7d8`
ran only the old canonical file, after the narrow guard preflights below. Both
assertions passed. A census of all **18,576 tracked test files** found exactly
one byte-changed path:

`tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/artifacts/direct-registered-curl-buffer-307-replay.json`

- Before: 2,402 bytes; SHA256 `de63affa918da53853a7f8bc9ad1d863802c46c524e74af6b48359826139bc17`.
- After: 2,393 bytes; SHA256 `ba6e0313257d6cf9a5164eec03ab7b2e23a885b10cbc84f5078c4dace0ccb0fd`.
- The Uint8Array case is also written by this code, but remains byte-identical:
  SHA256 `dc2022fdd8b4df2a68e10212aab2746081ac0f467a551d364faca5022a55b1a6`.

The changed Buffer field is the second request's bytes: the historical twelve
`238` bytes become `[0,255,128,195,40,10,13,0,254,65,226,40]`. This records the
already-fixed product behavior over the earlier defect capture. Both hashes and
bytes match the saved focused-v1 and focused-v2 before/after evidence exactly.
The saved canonical report names this exact changed path in the immutability
assertion and records the original full-gate temporary copy as removed. We did
not recreate, restore, or delete that historical copy. Original and reproduced
failed bytes and manifests remain independently preserved here.

## None of these 99 TAP pin failures is caused by that overwrite

This is based on every exact diagnostic, path/hash matching, guard source
inspection, and preflights on clean b494 **before any writer execution**, not
merely the routing labels:

| Rows | Exact guard target | Expected SHA256 | Clean b494 / logged actual SHA256 |
| ---: | --- | --- | --- |
| 89 | `tests/shell-stress/differential.test.ts` | `985d6e578841af649bbf4469fa69c48634070077baa9ecb85b60429da085e118` | `59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32` |
| 10 | `src/shell/shell.ts` | `0e1d1396490970bf8db4d74ab07115d73e8303d29d7b748e145a06b13b316fee` | `538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c` |

`diagnostic-profiles/profile.ts:97` compares the captured historical `tests/`
source hashes before the 88 compatibility bodies plus identity test can run.
Directly importing this actual module and calling `validateFrozenProfile()` in
the clean archive reproduced the exact differential-helper refusal. The pinned
native executable authentication preceding it also succeeded; no native shell
scenario or broad suite ran. The 89 historical rows are all this before-hook
refusal, not 89 independently run body failures.

`invocation-cleanup-public.test.ts:37` checks `frozenHashes` before its snapshot,
build, or worker launches. Running this actual file in the clean archive gave
all ten identical shell-source hook refusals, before those resource acquisitions.
The preflight did not change any tracked test bytes. The actual guarded paths
are disjoint from **both** artifact paths the direct writer writes, not only the
one whose final bytes changed. The conditional ambient finding is disjoint too.

Thus **0/99 caused by this writer; 99/99 proven preexisting candidate pin
mismatches** for these exact frozen rows. This is not a claim about other
failures, other source revisions, or hypothetical earlier executions. The separate
post-test integrity guard failure **is** attributed to the canonical writer.

## Reproduction and retained evidence

Run `node --unhandled-rejections=strict tests/stress/byte-ownership-20260827/remaining-consumers/writer-isolation-review/baseline.mjs`
only with unused owned output/scratch names. The script refuses existing output
files. It preserves the mutated archive separately from candidate verification.
`execution/baseline-result.json` and the before/after censuses bind exact paths,
bytes, hashes and retained affected snapshots. `execution/attribution-99.json`
contains the individually checked 99 rows. Child records include full commands,
strict rejection mode, PID, 45-second watchdog status, close settlement, and raw
stdout/stderr. No child watchdog fired. `execution/setup-attempt-1.json` retains
an archive-buffer setup failure before any extraction/test; its correction uses
file-backed compressed archive output, not a changed fixture or source.
