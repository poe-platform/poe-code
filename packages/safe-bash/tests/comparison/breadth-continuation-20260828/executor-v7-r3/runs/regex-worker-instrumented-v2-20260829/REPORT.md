# RegexWorker instrumented successor v2 — UNSAFE_STOP

Preseal: 73345acb732b6d1a5404f95ed94445a496730dd3; SEAL SHA256 47e2fe68c72b20afba8b9772d0c896773e44c4a415a6bacbf283708f03cb272a. One harmless attempt consumed; no retry.

## Actual outcomes

55 frozen identities: **18 raw qualifiers, 4 ordinary failures, 1 UNSAFE_STOP (G05.1), 32 unrun**. 23/51 child controls launched and naturally closed; four in-process DATA controls unrun. Outer owner and supervisor closed. **0/41 planned harmless Workers created; constructor-attempt counter0.** No target/comparator imports, C11, native or semantic calls.

Children stdout/stderr observed=retained **5819/4669 bytes**, outer **109/0**; total10597 bytes, zero recorded stream loss, all capture descriptors closed. This does not override UNSAFE_STOP. Raw REPORT retains conservative capture-plus-case byte accounting298146.

## Concrete blockers

1. First positive G01.1 failed before Worker acquisition: captured fs.writeFileSync in createPrivate still reaches guarded **fs.openSync.write** for owned worker-1.jsonl. The retained guard event and source establish the harness-owned write refusal; no product failure. Same cause affects the other three positive controls and G05.1. No full native stack was recorded; none is synthesized.
2. G05.1 postguard assumes its beforeNative drift mutation occurred. It never ran after the earlier refusal. The supervisor expected changed bytes, observed FILE_BOUND_METADATA and stopped. Standalone post-stop authentication proves original682-byte fixture bytes remain; it does not rescore the stop.
3. Negative constructor controls use refusal/qualified=false rather than every exact diagnostic; their 18 raw qualifiers are not universal or independently accepted boundary proof. Unexpected publication refusals in positives were classified ordinary failures by this frozen runner before the postguard stop; retain that classification fact for review.

## Approved instrumentation and missing proof

The exact key, own token/SAB4 shape, synchronous slot lock, finally restoration, sticky-only refusal, exact inherited guard and observer closure are sealed. Eleven malformed/pre-refused witness values hit the actual preload validator in each of23 children (**253 DATA rejections**, not additional cases). No child channel was actually installed. Cross-worker isolation, constructor/publication-failure restoration, nested load witnesses and thread reaping remain **UNRUN**, not inferred from source. No process.env/Worker env/workerData/transferList changes. Requested empty argv vs effective preload remains declared instrumentation, not caller authentication, tamper proofing or stock behavior.

## Next decision

Request a fresh narrow repair grant: use an explicitly owned bounded descriptor writer with captured primitive open/write/fsync/close and exact path/mode/census accounting, or precreate bounded witness files before guard activation; do NOT weaken the offline guard. Bind mutation-reached disposition before fixture postguard assessment, retaining the original failure and exact expected mutation bytes. Freeze exact refusal-code and publication-order controls before another harmless run. No repair or retry was performed after UNSAFE_STOP. Complete real-cohort integration still needs separate review and actual GO.

Prior draft source and all historical failures/losses remain immutable. Prior author checkpoint was1566256ms (26m06.256s),10 known processes closed, zero controls/Workers; no extension/refund. Fresh grant budget includes publication. See EVIDENCE.json and FINAL-ACCOUNTING.json for bounded final census and timing; Git publication outputs are separately preserved, not recursively claimed as self-authenticating evidence.
