# M1A v11: pre-execution harness HOLD

August28,2026, America/Chicago. The sole authorized cohort was launched and
stopped. **No retry; no product finding; no scoped M1A acceptance.**

- Preseal commit: `8f7e5977873de258f13a2978587f096b8adebaa9`.
- Preseal SHA256: `232a5061c366043cc184592a220f1c8be755b547b14eac286cb3ac7dcb38d692`.
- Exact command and limited tool-result transcription: `LAUNCH-RECEIPT.json`.
- All284 semantic groups are UNRUN: source71, compiled71, actual-installed71,
  moved71. Build/install2, types5, mutants3, restores3 and binding negatives3
  are also UNRUN. `UNRUN.json` preserves every exact role and case ID.
- One coordinator, zero spawned children, peak one cohort process. No syntax,
  compiler, npm, candidate, native/oracle, private or mechanical execution.

## Actual failure and capture limitation

The first tool-census disagreement is at `run.mjs:40`, before `run.mjs:171`
creates RUN-01. Python `prepare.py:29` sorts Path objects component-by-component;
JavaScript `run.mjs:28` sorts complete path strings. For @types/node, Python
orders `assert/strict.d.ts` before `assert.d.ts`; JavaScript does the reverse.
The order-sensitive deepEqual rejects identical path/value entries.

`POST-STOP-DATA.json` independently compares duplicate-free path/value maps and
complete directory/file/link censuses, using file reads only. All four tool
censuses have exactly unchanged membership and bytes. TypeScript and undici
also have identical sequence order; @types/node and npm do not. This is a
concrete **harness ordering defect**, not observed tool drift or product failure.
The runtime failed at @types/node and did not reach npm's same ordering issue.
The sealed executable is deliberately not repaired after launch.

A second harness defect limits the evidence: the coordinator only publishes
RESULT.json when its capture directory exists (`run.mjs:250`). Since pre-guard
failed before directory creation, no runtime capture or result file was written.
The exec tool returned exit1 and a console HOLD with children0, but truncated
the long assertion diff. LAUNCH-RECEIPT is explicitly a partial transcription,
not raw stdout, reconstructed RESULT, or a complete PID/signal/stdio receipt.
The whole original console cannot be recovered without an unauthorized replay.

## Exact resources and timing

The coordinator reported297.639917ms before final console publication; the
tool reported0.2614s wall time and exit1. Their clock scopes are not reconciled.
No signal/rescue was requested. The code sets process.exitCode and the tool
returned process exit; no separate coordinator PID or signal receipt survived.
Zero children/subject handles required cleanup. There was no subject cleanup
whose settlement could be qualified, and no global process inspection occurred.

RUN-01 never existed: zero runtime work bytes and zero runtime capture-file
bytes. Complete console byte count is unavailable. These are **not** claims
about RSS/native allocations or total source-preparation memory. The presealed
owned DATA/code artifacts occupy6,368,333bytes; subsequent evidence is separate.
The source preparation began20:59:49Z, froze21:23:21.561861Z and was committed
21:24:51Z (16:24:51-05:00). This is post-author preparation, approximately25m02s
through commit, outside the fresh runtime budget. The preparation script's
own recorded elapsed time is1238.387834ms, not the whole preparation duration.
Preparation/data audits and metadata Git commands are not candidate children;
no exhaustive process census of those terminal tools was recorded or claimed.

## Bound but unexecuted implementation

Worker SHA256: `7fdffa2d6bbd992546c5f6b203d5c9f25379181a38b1c7d7607531d3db76d1ba`.
Loader SHA256: `bbdd0f3e7e6d1e4083684f749b52b0a97837255344697ac83b06279222dab215`.
Observer SHA256: `8988827da7a4c23b44b563604640333a8121f0fd66a8f3ad47532de1e81afa30`.
The preseal commit binds27 files; PRESEAL.json lists26 payload hashes, twenty
child recipes, exact tools and membership.
`CRITERION.md` and `ROUTES-CAPACITY.json` bind all71 conditional routes, H10's
one call, a16,036,544-byte reservation per semantic layout, bounded traces,
actual offline install/move, mutants/restores and fail-closed loaded identities.
None of those execution assertions gained runtime credit from this launch.

All279 original candidate input rows and their decoded bytes remain exact.
The INPUTS JSON container was pretty-reserialized, so its outer hash differs;
this false container-identity result remains visible in POST-STOP-DATA and is
explained, not overwritten, in `SOURCE-DATA-SUPPLEMENT.json`. The harness-only
delta reverses exactly to original case SHA256
`807a2e32b286da6a7e979cc45c75d0985de1e49db79b9d1926627c7a444f8b21`.
The original full898 package SHA256 remains
`68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68`.
Base8437+Git988 is preserved, including original d2502aae Shell runtime; no
whole988 runtime substitution or production instrumentation was performed.

Private writer cleanup remains SOURCE_LINKED_CONDITIONAL_JOIN, not observed
private-Promise settlement. No new instrumented full71 was planned. Earlier
19+5 qualification,12+4 controls and three instrumented pilot cases are unchanged
prior evidence, not new credit. No arbitrary AbortError acceptance was executed.

## Preservation and next boundary

Complete post-stop file+directory censuses show unchanged v5/v6/v7/v8,
observer-v8-independent including reviewer, adapter-v9 and adapter-pilot-v10.
Every presealed v11 file is unchanged. Original69/H09STOP/215UNRUN and289/288,
all earlier qualifier failures and NativeGit6 HELD remain intact. Foreign work
was not staged or modified; the shared index was empty at observed checkpoints.

`NEXT-REVIEW.md` identifies the two minimal harness repairs for a **new version
and fresh authorization**, not an executable promotion of this consumed seal.
No product fix is justified. Full284 readiness remains blocked by this harness
HOLD and all runtime/type/mutant/binding proof is still absent.
