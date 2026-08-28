# Reachable adapter comparator audit — prospective continuation

2026-08-28 America/Chicago. Initial metadata08:06:20-0500; HEAD
83eed5879de47d89f231154079c8faeb2aadfa99. Post-original source inspection and
fb6f048d failure, not blind/pre-code. No continuation candidate import/control
before this recipe seal. Foreign staged/dirty work recorded, never owned here.

Original15 PASS /1 harness FAIL /2 UNEXECUTED, exit1, zero target spawns remain
byte-identical. This corrects only NEW independent adapters. No production code,
source permissions, profile, route or error-identity semantics change.

## Exhaustive reachable VALUE boundaries for A01–A03

Old paths below refer to pinned fb6f048d parent review.mjs; new paths are local.

| Boundary | Old comparison | New guard and exact semantic value |
| --- | --- | --- |
| Source spawn executable | :221 primitive equality | compare.mjs:30 exact primitive string, admitted Node path |
| Source spawn argv | :221 strict deepEqual | :31 Array.isArray; exact length/own indices/string values/order, no holes/extras/accessors |
| Source spawn options/env | :221 env deepEqual, no complete options-key check | :32 entire own-data object: cwd string, exact four-key env, detached true, exact three-element stdio |
| Source stdio | :222 strict deepEqual; observed realm failure | recursive :1/:32 permits matching cross-realm own-data arrays; no prototype equality |
| Source observer executable/argv | :166 strict deepEqual on argv; latent hazard | :36–37 exact ps path and two primitive arguments; role must be observer |
| Source observer options | formerly passed through without complete structure validation | :38 own descriptor timeout, integer1..2000; :40 exact encoding/timeout/maxBuffer keys/data |
| Independent worker ownership/absence observer | previously direct exec of known arguments | review.mjs:45 same observer value guard; independent of injected source observer |
| Sandbox delegation | known wrapper values | review.mjs:145 guarded source values, then fixed sandbox path/profile/Node/child argv and fixed exact options; three binaries authenticated before dispatch |
| Parent observer/controller launch | fixed Python lists/dictionaries, no JS realm | controller.py fixed admitted ps argv/env; owned Node command; PID/parent/birth/PGID scalar checks |
| Tool/file/module identity | primitive path/SHA/mode checks | left exact equality; no path coercion or permission exceptions |
| Primary/secondary/null/undefined error identity | :245 strict identity/includes | review.mjs:188/:196 unchanged object/primitive identity, NEVER normalized/stringified for assertion |
| Status/signal/closed/capture/observability | primitive equality | review.mjs:179–197 left exact; error/nonzero/UNKNOWN never promoted by footer |

No strict deepEqual/deepStrictEqual remains in continuation reachable role
validation. Candidate's own assertions remain byte-identical, not monkeypatched.
The unused wider phase/setup/import entrypoints are not linked or executed.

exactOwnData uses Reflect.ownKeys + Object.getOwnPropertyDescriptors; ownValue
uses a data descriptor. Accessors reject without invoking getters. Extra symbol
or nonenumerable own keys reject; holes cannot match dense expected indices.
Primitive strings compare exact JS values (including lone surrogate differences),
not lossy UTF-8 normalization. Cross-realm prototypes and descriptor mutability
flags are not value identity. No iterable/string coercion or unknown-key stripping.
After full validation, native dispatch uses the exact presealed host values;
this prevents native enumeration of incidental inherited properties. Caller
extras are rejected BEFORE reconstruction, never silently dropped. This is not
a security guarantee against malicious proxies/arbitrary host JavaScript.

## Companions, not retained supervisor-proof reruns

22 comparator data cases C01–C22 are enumerated in frozen review.mjs:87–108:
five cross-realm positives (stdio/argv/env/spawn options/observer options), then
wrong argv/value type, extra/missing element, hole, accessor, nonarray, extra
symbol key, extra/missing/accessor env, wrong spawn path/observer role, observer
options accessor, distinct lone surrogates, extra spawn option, timeout0.
Accessor sentinel must stay0 across all cases. These are independent adapter
controls, not shipping tool-admission or extra H11 production-case denominators.

Six collector DATA receipts K01–K06: natural closed0 accepted; otherwise ALL_PASS
footer plus exit1, signal, unclosed streams, timeout or overflow rejected. No
additional child is used. Controller separately preserves actual status/signal
and lexical stdout/stderr captures; no report text can override nonzero.

Each companion row and each source-spawn/source-observer admission/rejection/
dispatch counter is synchronously journaled before proceeding. Target registration
is atomically published BEFORE observation fault injection. Source and independent
parent observers are distinct; injected faults never replace rescue observation.

## Actual controls, only A01/A02/A03

- A01: Node emits distinct stdout/stderr, exits0 after500ms; clean/closed capture,
  real own birth known then absent.500ms replaces original100ms only to permit
  registration before natural exit; child bytes/lifetime separately hash-sealed.
- A02: Node intrinsic2000ms, source-observer faults null then undefined then same
  secondary Error. Real owned-handle SIGTERM, null status/SIGTERM close, exact
  fault identity, UNKNOWN/nonclean, both captures closed, external own absence.
- A03: Node natural500ms/exit0; source observation fails after close. UNKNOWN,
  nonclean, no signals, complete distinct streams and independent own absence.

All three whole supervisor instances have exactly the five original imports,
with only child_process adapters instrumented. Actual capture/fs/timers are real.
Whole shipping renderInstructionFence supplies the identical OS write policy;
tool-routing relative dependency supplies hash-bound route DATA and refuses live
inspection. This is NOT full superviseFencedWorker/phase IPC integration, native
semantic admission or new OS/library attestation. H06 disposition is unchanged.
