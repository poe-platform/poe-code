# DU75 admission-only v2 — stopped, no retry

Recipe commit: `5687fe0afe36749a9ec6527357acbb2eec518e4f`.
Recipe manifest SHA-256:
`420da89268b544b466dda8aa3cc214dab668338233e557b3efe45dee84b6ccd7`.
One-shot run manifest SHA-256:
`7571013470b55eae25634932ff024bed3eebe33a5c109b4af8aed820a8ca5d0b`.

## Actual result

STOP in `pre-authentication`: `never copy or read agent files in a census`.
The stack identifies `selectedLive` calling the recursive census, which rejects
an `AGENTS.md` directory-entry name before reading its contents. The census
walked a live selected directory recursively; it was not limited to the 771
committed inventory members. No additional search for captured agent files was
performed. This is an executor/preflight failure, not a DU behavior failure.

Eleven definitions were sealed unchanged. Nine were applicable, but **zero were
executed**: S01, A01, A02, A03, A04, A05, A07, P01 and P02 remain unexecuted due
to this earlier failure. A06 and P03 remain separately HELD, unexecuted, no pass.
There are no admission-control passes and no 11/11 claim.

Authenticated candidate input count: 0. Materialized: 0. Compiler builds: 0.
Emitted files checked: 0. Pack reproductions: 0. Pack members checked: 0.
Actual tool-module load proof: none; no compiler or npm child was started.
The pre-seal full tool closure and author-pack availability bindings remain
preparation evidence, not successful actual build/load/reproduction evidence.

The 21 read-only Git children started by the run all closed. No build/pack child
or product process ran. The run recorded 906 ms elapsed, childrenSettled=true
and scratchRemoved=true. No candidate scratch was created. No retry, reseal,
replacement executor, public dispatch or product/source/config change followed.

## Integrity and limits

The automatic POST phase encountered the same live-census refusal. Therefore
the complete source/tool/fixture PRE/POST proof is **not established**; neither
PRE.json nor POST.json was successfully persisted. The raw failure, automatic
POST failure, numeric zero counts and settlement survive in run-v2/RESULT.json
and events.jsonl, authenticated by the unchanged run-v2 manifest.

`post-run-original-bindings.json` is a separately labeled, read-only final
verification against immutable Git objects. It authenticates the original six
and original fifteen file bytes/modes, exact original fifteen-file namespace,
and the sealed recipe. It is not a rerun of S01, a replacement for the failed
complete PRE/POST capture, or a candidate admission result. It does not inspect
or consume live product bytes. The original wrapper and validator were never
executed, changed or relabeled.

All29 public cases remain HELD pending actual accepted HTML74 and separately
authorized public replay. No install, physical move, public imports, declaration
consumers, private-helper approval, DU behavior, public-default acceptance,
metadata/native/public cohort, RSS diagnosis or full archive/whole-gate proof
is claimed. Existing HTML and RSS holds are unchanged.
