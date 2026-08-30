# Concrete ROOT decisions requested

2026-08-28. Recommendations only; L selection itself is already settled. Original
NP1-CJS whole-guest8MiB/all-jobs-settled remains HOLD. No execution or production GO
is requested by recording these choices.

## D1 — Smallest useful first module

Choose an explicit optional-provider **L-entry-return / synchronous text-I/O**
profile first. Preserve the NP1-CJS CLI: `.cjs`, eval statements, primitive `-p`
expression, stdin source; virtual argv/env/cwd; fd0; JSON editing; POSIX path
helpers; granted stdout/stderr. No npm/npx/host fallback. No `module`/`exports`
wrapper API or general Node compatibility is implied by NP1-CJS's name.

Provide sync `fs.readFileSync` and `writeFileSync` text forms, `w` and actual
exclusive `wx`, fixed `fs`/`path`/`process` modules and their node aliases, and
authorized explicit JSON requires with guest cache identity. Retain the existing
source/data BOM and replacement UTF8 policy. Writes default deny; source/data/JSON/
stdin/stdout/stderr grants remain distinct. Complete syntax preflight before guest
execution; computed unsupported requires refuse at the call, not before earlier
effects. Confinement must be supported by the actual namespace, not a lexical
path-prefix assertion.

Explicitly defer promise-fs, `fs/promises`, modeled `process.exit`, and claims about
pending Promise completion to a later **L-guest-exit** profile. Ordinary language
Promisey computations, if retained by the grammar, may be abandoned at entry
return; do not call that synchronous-only-language enforcement or all-jobs
settlement. `.js`/ESM/TLA/local executable modules/package search remain deferred.
Keep the three-slot197056-byte layout if helpful; slots1/2 are reserved/inactive in
this first profile. Do not call that unchanged WRQ02/04/06 async acceptance.

The first useful workflow is a `.cjs` script reading authorized JSON, mutating its
guest object, writing JSON to an explicitly granted destination, and publishing a
bounded confirmation; both overwrite and exclusive-create paths must be shown.
Primitive `-p`, stdin source followed by fd0 EOF, and JSON alias identity are
separate required workflows. No source-only review establishes these today.

If ROOT requires async first, retain both slots and select **L-guest-exit per
invocation**: top-level return is not terminal, explicit modeled exit0..255 is;
missing terminal intent reaches the existing private admission deadline. Its
sync callback sends terminal intent and remains terminally blocked until actual
Worker exit (not a catchable guest throw). This adds WRQ04 async scheduling and
WRQ06 abandonment/error delivery obligations; do not silently select it for the
sync-first profile.

## D2 — Cutoff and statuses

Accept L-CUT-1 with the concrete F2/F5 clarifications: complete-payload effect
admission, parent serialized cutoff, zero deliberate postcutoff guest service,
source-bound bridge-handoff evidence distinct from transport ACK, and retained
undelivered parent rejection. Sync terminal ordering is only a candidate witness;
the async path needs its own post-handoff receipt, as specified in F5.
Precutoff valid operations drain without cancellation on normal retirement.
Primitive print publishes before terminal event, within existing quotas.

Proposed external outcome table, **only after actual exit plus parent cleanup**:

| Outcome | Recommendation |
|---|---|
| Valid selected entry return, no failure | exit0, classified intentional retirement; unknown guest pending count |
| Later selected explicit guest exit | requested0..255, same ownership checks; not Worker termination code |
| Guest program failure | exit1 with bounded authorized diagnostic |
| Usage/unsupported profile/protocol/private limit or private5s admission expiry | exit2, distinguished internal reason/classification |
| Parent caller/control or actual sink/cleanup/escaping host rejection | preserve original host value/provenance and existing Shell mapping; no conversion into the previous numeric row |
| Exit or parent cleanup unconfirmed | remain owned/unsettled; no numeric success/failure receipt falsely certifying closure |

The old NP1 resource124 proposal is **not silently rescored as2**; this is the
separate Worker profile's explicit choice. Preserve multiple failures and existing
root-caller > escaping execution/control > local cancellation priority. An ordinary
FS rejection delivered to guest before cutoff is not automatically an escaping
parent failure. Unknown-code handling needs the F7 finite error-table decision.

## D3 — Numbers and admission/cleanup boundary

Recommend retaining proposed maxima, not increasing them: one Worker/run/session,
source256KiB, encoded context64KiB, path1024 UTF8 bytes, metadata8KiB, error
message1024 bytes, each text operation1MiB, cumulative reads4MiB/writes4MiB,
combined output1MiB, JSON cache32 entries/input1MiB, up to4 fixed module records,
128 operation sequences,4096 total frames,8192 wake epochs,16MiB named live
reservations, V8 old32/young8/code8/stack4MiB, engine100000 steps/call depth128,
parser65536 tokens/depth128. These need actual provider enforcement proof.

Use the existing5,000ms **admission** timer from command ownership enrollment,
including startup/source preparation. Close it at valid normal cutoff so it does
not later abort normal preadmitted drain. Caller cancellation remains live through
the cleanup barrier. No new drain allowance, quota reset, or actual wall-clock
termination guarantee. On failure/cancel set stop/wake and request termination
immediately (zero grace, within the proposed maximum100ms); do not wait for a
blocked Worker's JS listener. Uncooperative parent cleanup or unknown exit stays
owned rather than being turned into a100ms success or rejected-clean receipt.

Counters are private. Normal Shell command admission and existing budgeted sinks
remain in force; no new public Budget API or per-RPC command tick. Result sizes,
source/context copies, framing and error records need an explicit reservation
table before implementation; no whole-guest/RSS inference from16MiB.

## Required design corrections before author implementation

1. Version the F2 upload-credit/ACK-data and frame-allocation rules (or an equally
   complete alternative), maintaining fixed storage and finite counts.
2. Specify trusted interpreted facade/cache/bootstrap binding and hidden rawbridge
   accessibility tests; disclose copy-before-validation and resource boundaries.
3. Bind real CommandContext cleanup/sinks/caller behavior and the error vocabulary;
   no invented shared-Budget API, reason-equality provenance or failed-owner receipt.
4. Seal exact static parent/Worker entries and transitive public engine/tool closure,
   launch policy and resource enforcement controls **before** actual Worker/engine
   experiments. Zero-runtime-dependency core still requires a truthful supplied
   provider; no undocumented automatic package/private import.

All eight WRQ/L obligations remain runtime-unrun. The current review supports a
bounded next design/implementation packet, not provider acceptance or native Node
compatibility.
