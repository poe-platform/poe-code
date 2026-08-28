# Independent observer qualification v6 — PARTIAL HOLD

Friday, August 28, 2026. **STOPPED ON HARNESS OWNED-CLEANUP FAILURE. NO RETRY.
NO PRODUCT FIX, PRODUCT ACCEPTANCE OR CANDIDATE CONTINUATION GO.**

Preseal commit: `65b73e44d5641b5472e2b96000d51d5b6f81f7ff`.
Observer v6.1 SHA256:
`2f6b88f05d53d8c4c5b95724baddc3b6b7e825163f05abb6c69bcdf161de4abb`.
Evidence is this handoff, untouched RUN-01 receipts/raw JSONL, AUDIT.json and
CONTINUATION-PROPOSED.json. Full evidence commit is reported in the final handoff
message rather than attempting a self-referential commit field in its own tree.

## Result and denominators

| Role | Frozen | Executed | Result |
| --- | ---: | ---: | --- |
| Real builtin inflate cases | 6 | 2 | R01 PASS; R02 failed expectation / safety STOP |
| Synthetic state-machine cases | 10 | 0 | All UNEXECUTED, no injection successes credited |
| Source-data qualification cases | 2 | 0 | Both UNEXECUTED; earlier source preparation is not their execution |
| Direct qualification children | 1 | 1 | Worker exit 1, signal null, close observed |
| Syntax children | 0 | 0 | No separate parse-check probes |
| Standalone controls children | 0 | 0 | Controls are inside the one worker |
| Candidate/build/native Git children | 0 | 0 | None admitted |

R03–R06, S01–S10 and D01–D02 are all unexecuted. No second cohort, rescore,
candidate API import, transpilation, build, private package or product execution
occurred. No failure was hidden by continuing to the easier synthetic controls.

R01 consumes the fresh compressed `blob 5\0hello`: exact bytes match; write and
end callbacks settle; owned cleanup settles; state and delivery are clear.
Both old event-only and proposed state/cleanup predicates are clear on the SAME
captured independent fixture. Its trace additionally records closed=true before
delivery at destroy-returned; that incidental fact does not count R06 as executed.

R02 uses small literal invalid zlib input. It observes `Z_DATA_ERROR`, destroy,
closed=true and the actual close event, but its write callback count remains 0
and writePending=1. The owned writer cleanup times out at 3s and cleanup is
rejected. Old event-only predicate CLEAR versus proposed HOLD is calculated from
the SAME raw snapshots. Frozen expected PASS fails; it is not changed to HOLD.
This demonstrates why close notification alone does not settle a separately
pending promise, not a native leak or a candidate failure. The source-only review
finds a preparation defect: the independent writer omitted the frozen codec's
close-listener settlement alternative. No code is changed after the seal.

The proposal is therefore **not qualified**. Its pending raw-callback criterion
also needs explicit ROOT review before an adapter could distinguish callback
notification from a close-settled operation without hiding actual pending cleanup.
WORKER-ADAPTER-PROPOSAL.md states this boundary and does not supply a pretending-to-
be-qualified executable adapter. No all-future-late-error guarantee is claimed.

## Primary sources and limits

All six exact Node 22.22.2 official HTML, tagged documentation and tagged JS source
URLs are accessible and retained as SOURCE/DATA with SHA256 in NODE-SOURCES.json.
The exact sources were fetched via web and then directly captured; no generic
main-branch issue search substitutes for them. The captured destroy.js hash
74aaae64ff7e4553fbf981baffb1f1dab7748c1e3fedfbef59eb8ab9ed4ec22d also matches the
prior bound-runtime embedded-source receipt; no new embedded-source execution
was needed. Node binary SHA256 is the prior preseal binding:
5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011.

The docs' closed description is not read as proof that delivery already occurred:
tagged onDestroy sets closed before scheduling error/close on nextTick. Destroyed
is earlier still. Tagged zlib requests native close and clears a JS reference;
that private implementation detail proves neither native allocation release time
nor workerpool preemption. No private _handle polling, RSS claim, universal
descendant claim, calibrated sleep or general external-resource guarantee occurs.
Real R01/R02 traces are consistent with that version-specific ordering. Late-error,
falsy-reason and pending-cleanup synthetic cases remain unqualified, not passes.

## Process, time and storage evidence

The supervisor owns worker PID15910; worker birth records parent15909 and
monotonic birth186063048054041ns. Immediate knownHandles enrollment precedes
fallible listener setup. Worker exits naturally with code1 and no signal;
ChildProcess close plus stdout/stderr close are observed. Finally cleanup of the
known ChildProcess settles; no TERM/KILL is sent. Supervisor also returns code1
naturally through the execution tool. This does NOT claim the R02 writer promise
settled: its cleanup stayed rejected, despite natural process closure.

One direct worker, one coordinator, peak two known owned processes; no worker
children, syntax probes, native observer, OS-global process scan or subagents.
Source/data metadata tools are not target children; prepare.py records its32
Git metadata children explicitly. Other interactive status/read/hash/doc/data
preparation and audit commands are not silently counted as qualification workers.

Run starts2026-08-28T18:44:09.648Z; owned cleanup and postguard finish before
2026-08-28T18:44:12.827Z. Measured interval through pre-receipt publication cutoff
is3179.155875ms, including pre/post guards and owned cleanup, below600000ms.
The final receipt file write is after that clock sample; no exact post-write
monotonic duration is invented. Worker elapsed3006.264709ms; R01=2.0695ms,
R02=3002.735292ms. These are not performance benchmarks. Publication/audit is
separate source/data work, with its own timestamp in AUDIT.json.

Raw stdout is21573 bytes, stderr0; all RUN-01 files including receipt total25004
bytes, below32MiB. Owned content before receipt is965930 bytes, then969361 bytes
including receipt, below128MiB; final publication size is separately audited.
These are captured/scratch file bytes, not peak memory or native allocation.
R01 and R02 each report maxima1 for unobserved notifications, not-closed states
and pending states; those measurements do not reinstate a one-live-native rule.

Source preparation's first reliable wall clock is18:33:14Z and freeze is
18:43:38.310787Z:624310.787ms wall elapsed, separately from qualification. Initial
status/doc inspection before the first timestamp was unmeasured and is not claimed
as measured work. The final preparation script itself measured1903.074209ms.
No inherited110-minute budget or72-hour duration is claimed.

## History and proposed continuation

All25 original v5 files match evidence655cb37b97521558c4c90581b5b23fc6c3ad9bf2;
preseal f38984ec68477a620792b5e899f7f29aa586bc9f remains immutable. Pre/post guards
check complete regular-file inventories including newly added files, not merely
original paths. They reject symlinks. Empty nested directories are NOT inventoried:
the receipt's newEntriesChecked is not an append-proof directory-tree claim. This
qualifies the preseal's broader inventory wording without changing its bytes.
All sealed new inputs and the Node executable hash also match. No production,
author module, root export/configuration, old fixture or unrelated worker file
was edited. Atomic commits name individual owned paths with hooks disabled;
foreign index/work is preserved.

Original289 creations/288 delivered close events,69 semantic passes,H09 safety
STOP and215 unexecuted layout groups are unchanged and cannot be remapped using
new states absent from that capture. Native Git's six workflows remain held.

CONTINUATION-PROPOSED.json binds a NONEXECUTABLE, INVALID/UNAPPROVED proposal.
Recommendation after a separately qualified successor observer and fresh ROOT
authorization: rerun all71 source groups in original order, not only H09. A
H09-only result cannot rebind the69 earlier groups to a new observer. Then retain
the original14 other children: compiled/staged/moved3, positive/negative types5,
mutants3 and binding-negatives3. That proposes15 future direct children and284
fresh layout groups, including69 repeats and all215 original remaining groups;
it does not silently enlarge this qualification's one-child execution authority.
The proposal uses a fresh bounded clock, not the old110-minute allowance.
No command from that proposed continuation is executed here. ROOT must resolve
the observer/cleanup model first; no production fix is justified by this record.
