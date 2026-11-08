# Raman read-only handoff — preparation v1

2026-08-28. **PREPARED, NOT EXECUTED; no experiment GO.** Review only these frozen
inputs. Do not activate the supervisor, import the entry/engine, build/install,
access the private checkout, or expand the source/tool closure. ROOT must issue a
fresh hash-bound GO after a satisfactory independent review. Prior design and
source-feasibility history remain byte-identical.

## Exact review binding

- Execution/code-freeze commit: `570e5accd0ff9686fbdc0b00ab1d01a20c82950e`.
- `MANIFEST.json` SHA256: `c163bcd7cc0686dc7d4ab67ba24429fe4900c68c244cdf46799bff5b12b4e213`.
- `SOURCES.json` SHA256: `a670629995f8cb7331a5e24d35ad4bb185dc0fbe5f70de8281598de615cd35b1`.
- `TOOLS.json` SHA256: `4efc7ff6181d6f92dd9aa3fe67803c55af027adc734b701582998efb452ae788`.
- `VALIDATION.json` SHA256: `649a2d7dccc42e83392f411d5fcaad8f473cf7e8ee5aafc433bfcc6977737e94`.

The manifest excludes only the named handoff/validation notes and separate
authority/output directories. A subsequent notes-only seal does not replace the
execution commit. Review the actual `.mjs.data` bodies, not just this description.

## Mechanism and remaining risks

Source supports an existing private seam, not a universal impossibility claim:
`values.ts#createSandboxClosure` produces an actual same-instance unflagged
intrinsic; the evaluator's `invokeSandboxClosure` non-async branch awaits
`wrapHostResult(result, stack)`. A native Promise can therefore suspend an ordinary
guest call internally without making its result a guest Promise. Ordinary host
callbacks instead traverse `executeHostCall`/`createHostCallPromise` and box the
Promise; explicit guest await unwraps it and uses `suspendJob`. The frozen report
pins the exact branches and source lines. These are source findings, not new
measured semantics.

`reference-entry.mjs.data:1` imports the actual internal factory from the selected
public-source tree beside `run`, `Budget`, and the host bridge. Its host binding
supplies the factory indirectly; the guest never receives it or raw VFS authority.
No brand synthesis, engine modification, automatic command import, or public-API
claim is involved. The optional qualifying provider remains the command/core
boundary; this adapter is test-only.

Review especially the ordinary-call versus await job ordering, delayed rejection
catching, persistent guest-data identity, and F06 raw control-reason provenance.
The provider envelope, not the frozen engine, preserves exact caller object/null
rejection and awaits held cleanup. Dynamic counters surround actual calls/read
admission/settlement; internal Budget reset counts are explicitly unmeasured. One
Budget and one real run occur per evaluation, not new budgets per host call.
Logical cache retirement is not reclamation of all JS references. Bounded
microtask readiness failures are inconclusive/failures, never passes. The new
orchestration and adapter have not inherited runtime acceptance from the old
supervisor/loader review.

## Fixed execution recipe for a later GO

Seven unchanged F01–F07 guest programs from
`6abfe0bb98d9987dd4dee32c0882bb48cc15d007`; **eight evaluations**, in order:
`F01,F02,F03,F04,F05,F06-object,F06-null,F07`. The sole additional evaluation uses
the unchanged F06 program with null instead of its object abort reason: one signal
cannot first-abort with both. `MECHANISM.json` pre-seals this narrow obligation.
There are no retries or old6/25 reruns.

After review, ROOT records the exact `REVIEW.template.json` schema under `reviews/`:
reviewer `Raman`, disposition `READY_FOR_FRESH_ROOT_GO`, execution commit/manifest
above, completion time and bounded findings. ROOT then records the exact
`GRANT.template.json` schema at `authorizations/<unused-run-id>.json`, setting
`authorized:true`, the same commit/manifest, matching run ID, review path/hash,
and a later `authorizedAt`. Preserve the exact eight labels, guestEvaluations8,
source/tool hashes, ABI string and limits; `privateAccess:false`, `retry:false`.
Hash the final review and grant bytes. No additional keys or closure expansion.

From `/Users/kjopek/Workspace/safe-bash`, the exact launch shape is:

```sh
VNABI_ROOT_GO='VNABI-GO:570e5accd0ff9686fbdc0b00ab1d01a20c82950e:c163bcd7cc0686dc7d4ab67ba24429fe4900c68c244cdf46799bff5b12b4e213:F01,F02,F03,F04,F05,F06-object,F06-null,F07:8:<unused-run-id>:<grantSha256>:<reviewSha256>' /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --input-type=module < tests/commands/node-provider-experiments-20260828/supervisor.mjs.data
```

Placeholders are deliberately non-authorizing. The supervisor authenticates its
manifest through a bounded public-repository Git child; no private guard/copy is
needed. It reconstructs regular isolated source files from the compact archive,
not symlinks/worktrees. All66 files authenticate to engine
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`: prior63 plus the three source-only
index/core/package inputs, covering all18 feasibility inputs. Runtime admissions
are bounded to prior63, with exact inherited emitted hashes; unknown loads STOP.

The inherited reference is `f199787165ed3cfba82152cde31c5b794e03fad0`, executor
`6d7159e35a1cd92b0ede967d3fe428d54a74d4bd`, toolclosure
`808f95497540375aed43c83d305482359e216773bae5d02ccf7f68539dff605f`, engineclosure
`3be5cdcd7869e0b50da41335a34c7aa44a19abcd089ea3c86290529bf08ab687`.
They are history, not current acceptance. New tools are four hashed files: pinned
Node, Git, TypeScript compiler and its package metadata; zero npm/install. The
old loader is byte-identical; `REUSE.json` identifies exact reused supervisor
functions and changed orchestration. No new system/dyld library census is claimed.

## Bounds, receipts, stop conditions

Nine direct children maximum (one Git plus eight engine children), serial;
ten processes including supervisor. Overall480s including30s cleanup reserve;
each evaluation30s, TERM1s, KILL/reap1s. Scratch192MiB/512 entries; source
decode4MiB/member256KiB; each trace2MiB/4096 rows; receipt/stdout/stderr64KiB each;
logs32MiB; final raw and encoded archives64MiB each. Per evaluation: source4KiB,
steps2000, depth32, data65536, string4096, array256, deadline1000ms, one pending
read, sixteen host operations, eight guest records, thirty-two events. These are
finite experiment bounds, not NP1 product caps or an OS-stall preemption guarantee.

Actual-load traces, semantic host assertions, operation witnesses, raw engine
outcomes and cleanup/public-settlement ordering must agree. Clean assertion
failures drain and pass guards before continuing; safety failures stop, no retry.
Archive authenticated captures before scratch removal, then recheck guards and
write/re-read `CLOSURE.json`. Status0 requires every outcome, natural child close,
guard, archive and cleanup; no receipt string alone qualifies. Missing receipts
leave actual evaluation count unknown. Unsafe retained work leaves STOP/scratch.

Post-freeze preparation checks: four syntax-only Node processes passed; JSON,
commit/tree/blob/archive bindings, all18 inputs, unchanged historical artifacts,
four tool hashes, and pre/post input hashes checked. **Zero engine evaluations,
entry/supervisor activations, loader/compiler imports, builds, installs, synthetic
executions, native oracle runs, or private reads/writes.**

Remaining action is independent review, then a separately authorized measured run
of this exact recipe if approved. Any required code change needs a new versioned
freeze/review binding. No product/fullNode/NP1 acceptance follows from preparation.
