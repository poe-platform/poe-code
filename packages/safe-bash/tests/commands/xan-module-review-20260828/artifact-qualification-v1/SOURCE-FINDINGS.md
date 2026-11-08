# Source-only findings for future authorized review

Candidate `0ec84fc38c3fafd75776d80148d4f3c2d77e6247`; ten-file overlay only.
Source-audit seal `e3d2cec5f4e3dbe2e06b40caf2b35f0811f0bebf` supplies exact
blob/SHA bindings in `SOURCE-FINDINGS.json`. Pinned Git excerpts were read, not
imported/executed. No repair authorization is granted. Source arithmetic does not
become measured allocation, observed timer behavior or vulnerability evidence.

## SA-01 — repeated inspection and output work accounting

`src/commands/xan/selector.ts:8` performs numeric regex, leading-zero replacement
and BigInt parsing without receiving Budget. At `selector.ts:34`, one work charge
precedes a doubled-quote lookahead/two-character advance. At
`src/commands/xan/index.ts:48`, diagnostic sizing/encoding/copy charges omit the
distinct ordinary output-byte charge at `src/commands/xan/io.ts:155`.
The frozen work rule charges repeated inspections and output separately.

Current evidence: source call structure and explicit-charge arithmetic only.
Possible falsifiers/uncertainties: a separately bound charge elsewhere that pays
these repeated operations, a different lawful accounting interpretation, or
earlier admission that prevents the proposed path. Initial argv inspection alone
does not establish payment for repeated scans. Future conceptual observation:
compare an independently enumerated bounded numeric/quoted-selector path with
actual admission/effects under separately authorized review. No trace hook or
actual counter capture currently exists; no runnable workload is supplied here.

## SA-02 — header display-line simultaneous retention

`src/commands/xan/commands.ts:204` constructs a display-line string before
`src/commands/xan/writer.ts:74` sizes/encodes it. Budget encoding at
`src/commands/xan/budget.ts:47` holds encoded bytes, not that new UTF-16 string.
The frozen capacity rule counts two bytes per live UTF-16 unit, independent of
engine rope storage. Earlier name/display lifetimes are at commands lines 121–170.

Read-only arithmetic for the pre-existing 4096-character header witness:
160 metadata + 8192 capacities + 16384 name/display = **24736** persistent;
largest earlier explicit hold **32960**; plus 4097 encoded line = **28833**;
missing 4097-unit string = **8194**; simultaneous lower bound **37027**, above the
proposed cap **33000**. No actual success, allocation or output was observed.
Possible falsifiers: different truthful lifetime release before line creation,
an existing reservation covering the line, or earlier refusal on this exact path.
Future conceptual observation: bound actual external admission/output against
this independent live-capacity ledger, if separately authorized. Not an RSS claim.

## SA-03 — cooperative checkpoint gaps

`src/commands/xan/budget.ts:25` charges work and checks cancellation but only
checkpoint at line 26 yields after 65536 units. Doubled-quote `continue` at
`src/commands/xan/selector.ts:36` skips its loop checkpoint; header trim at
`src/commands/xan/commands.ts:107` has no checkpoint; mismatch return at
`src/commands/xan/selector.ts:99` bypasses the inner checkpoint while outer
wildcard traversal at line 144 has none.

65537 doubled pairs imply 65537 charged loop iterations and 131076 selector bytes
including exterior quotes, with no checkpoint on that branch. This is a static
gap under the stated permissible size overrides, not a measured delay or proof
of phase-specific timer delivery. Possible falsifiers/uncertainties: earlier
rejection, a different reached branch or interleaved checkpoint; microtask awaits
are not automatically proof that a host timer ran. Future conceptual observation:
bounded cooperative progress/cancellation evidence with trustworthy attribution,
only after separate authorization. Already-aborted checks and uncooperative host
preemption are different claims.

## Held evidence

Static-repro preseal `08dd69d06a2f40edd31263631605ae153a9cf318` contains fourteen
case IDs, reproduced as IDs only in the matrix. **14 × 2 = 28 observations remain
HELD/UNEXECUTED**. No blocked recipe was launched, revised or routed through an
alternate runner. The historical tool risk flag is not cybervulnerability evidence.
