# Timeout verifier reconciliation: completed tail, PC01 proposal for root

## Scope and chronology

Recipe `7e6a0b781a2d0cb9e1bc7b0dd02ee973cd857504`, manifest SHA256
`32ebd8694afc58d317303b5ea631ee757c2f91e4be0d139ae1ab3f66eacb9fdd`.
One execution: August28,2026, 03:47:59.870–03:48:19.008 UTC, pinned Node22.22.2.
Candidate remains `9ed9a0f14d12758713a8dc42be1ff75f0c87a36f`, fixed baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290` plus the four exact module files.

No product edit, original freeze edit, original rescore or full-cohort replay.
All77 original case assertion lines remain byte-identical; PC01 only receives
pre-assertion observation and actual dispatch counters. The root TypeScript
consumer payload is byte-identical. `recipe/ADAPTER.json` binds old and new file
hashes and every replacement; patched bytes are not vouched for by old hashes.

New F22 source `a23867d6a42e1cb2f2e7278cf22061737a4bea9d`, author freeze
`72a109971d6c82f783ae91de62f7c15e2af21d8b`, evidence
`b53f7fff5a2a33c8ab3501ead65d40fadcfbc644` arrived after this recipe and run.
That new source has not been inspected, independently authenticated or executed
here. It needs its own versioned followup, after root's PC01 boundary decision.

## New actual results

- Focused predicate controls: **28/28** (13 exact root-type,10 designated source
  denial,5 exact public-subpath denial). Includes generic assertion, wrong guard,
  wrong source target, extra product load, helper tamper and unrelated compiler
  failures; no broad diagnostic or error-code whitelist.
- Corrected root-negative types: **2/2**, installed and moved. Exact TS2724 at
  `consumer.ts(1,10)`, exit2, no stderr, one exact diagnostic with final LF:
  `'"virtual-bash"' has no exported member named 'createTimeoutCommand'. Did you mean 'createTimeEnvCommands'?`
  Each compiler actually reads263 files, including85 package declarations with
  the real root `dist/index.d.ts` and authenticated transitive closure. The old
  seven other type outcomes are not replayed; original7/8 and F01 failures remain.
- PC01 diagnostics: both layouts complete both routes, while the unchanged
  original outer-rejection predicate still fails. These are observations, not
  two PC01 passes or a new semantic acceptance.
- A09 newly captured exact-guard diagnosis: **qualified**. A10 actual missing
  public-subpath export negative: **qualified**. Each loads only its authenticated
  helper and zero product modules.
- Original exact source mutants: **M01 and M02 both killed by their designated
  unchanged predicates**. Their historical unexecuted state remains preserved.

All9 asynchronous children completed naturally and were reaped;284 synchronous
Git operations returned naturally. Final integrity passes:16 supervisor guards,
four per-case post guards, no watchdog/forced exits. Source/moved diagnostics
each settle5 tracked promises and dispose2 Shells; M01 settles2/disposes1; M02
settles1/disposes0. All have zero pending work/owned fake timers, unhandled or
disposal rejections. Each of four runtime profiles records215 actual module loads
(210 product). Tools record556 actual CJS compiles and1,095 file reads.

The declared268-input Git reconstruction,2,274 regular tools/12 metadata-only
aliases and857-member package are authenticated before use and after execution.
Fresh offline install and physical move execute. Exact package SHA256 remains
`32e2bef5eafbb00e9b6704e2765f55e36514eda0da0fe84ea78367813c756630`.
Its previous actual build/pack reproduction is bound, **not rerun**.

## PC01: exact boundary split proposed, NOT applied

In both source and moved new captures:

1. **Root-caller route unchanged:** actual raw timeout handler and outer Shell
   reject the exact observed own-deadline object reused as caller reason. Neither
   settles before child cleanup release; child and retirement resources close.
2. **Borrowed outer-invoke route:** actual dispatch is outer1/timeout1/child1.
   Raw timeout handler **and raw `context.invoke` promise** reject that exact
   object; neither returns124. The live outer Shell then fulfills with status1,
   stdout exactly empty, stderr exactly31 UTF-8 bytes:
   `shell: line 1: [object Object]\n`.
   Both handler and outer were pending before cleanup release; childClosed=true,
   resources=0. The outer forwarding handler returns the original invoke promise
   unchanged; observing it does not replace it with another promise.

Root proposal: keep all sentinel identity/activation/pending/closure assertions,
keep the root-caller outer rejection, and split only the borrowed route's outer
boundary to exact status1/empty stdout/the31-byte stderr. Require its raw handler
and raw invoke to reject the exact sentinel, never124. This matches root's
accepted Stage2 mapping of a live outer handler error. Do not introduce a global
rule about arbitrary host errors. `evidence/PC01-BOUNDARY-PROPOSAL.json` carries
the complete proposed values, new observations and explicit NOT-APPLIED status.

M01 demonstrates why raw observation stays mandatory: the mutant returns124
from the handler while outer root Shell still rejects the caller. The original
`HANDLER_RETURNED_STATUS` assertion kills it. M02 actually enters product-owned
retirement and throws the identical observed sentinel, but its mutant handler
returns124; `RETIREMENT_MAPPED_TO_STATUS` kills it. Activation and closure are
durably captured before assertion, not inferred from the error label.

## A09: verified harness setup mismatch, not admission escape

The NEW full caught message is exactly
`UNBOUND_MODULE:/Users/kjopek/Workspace/safe-bash/src/index.ts`.
Its stack identifies `preload.mjs`'s `Object.hasOwn(config.loads,path)` assertion;
the pre-assertion guard receipt records that exact target and guard before load.
Error name AssertionError/code ERR_ASSERTION/actual=false/expected=true/operator
`==` are retained. Only the helper loaded, not the external product target.

The old helper expected the later filesystem-permission denial, but the earlier
strict load allowlist rejects first. The versioned correction requires this exact
guard/path/message and authenticated load evidence. Generic ERR_ASSERTION still
fails focused controls. This proves strict fallback denial, not independent
permission-layer enforcement. The original missing caught message remains
missing; these are new captures, not recovered historical bytes.

## Remaining boundary and evidence

No declared current diagnostic/control tail is unexecuted. Root must decide the
PC01 proposal before a semantic assertion amendment. New F22 source followup
must independently bind/review the receiver-only repair and execute its remaining
source/moved obligations, including formerly unexecuted F22 timer-resource and
resolver126/127 checks. Original31/34, original7/8, A09 stop and prior unexecuted
tail remain in their original receipts. Native0; SafeJS0. No public/default,
whole-gate or separate private-helper acceptance.

`evidence/RESULT-original.json` retains the new supervisor receipt byte-for-byte.
`raw-and-configs.jsonl.gz` is a lossless data archive with per-file path/mode/size/
SHA256/base64; full fresh-work inventory is separate. Only owned raw/scratch was
removed after archival verification and reaping. Post-sealer executes no product
or control. `EVIDENCE-MANIFEST.json` binds all new files and the unchanged recipe;
old freezes and130 protected inputs are reauthenticated without modification.
