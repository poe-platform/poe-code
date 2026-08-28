# New mapfile observer: author synthetic handoff

August28,2026. **Different review requested; no native/product execution GO.**
Only `tests/shell/mapfile-design-20260828/**` changed. No product, array, private
input API, runtime, permission, root configuration, or other worker fixture edits.

## Exact candidates and results

| Role | Commit / outcome |
| --- | --- |
| Original design32 | `1fe588eeba0cdb09adfb948eeded681d15d134f2`, unchanged six original files |
| Additive11 + first precode | `cc47148522aa57beb072d19da6a8fcc4bd907455` |
| First concrete seven modules | `9418c3cf524a144fe419f9f67a1695339e262a8e` |
| First result + supplemental precode | `d9608e2311c82c69f9383393eb68483f825a2a5f`, original28/28 |
| Revised concrete modules | `f2352a6300925480aaa53a494f6014b1d54a9618` |
| Revised synthetic execution | Original28/28 + separately presealed9/9; CLI missing-admission rejection also passes |

Revised module seal SHA256:
`d08585b8995ffd1399be27c17dc378357707106b93f12c240e92ffe57dadadc4`.
Combined43-recipe JSON serialization SHA256:
`18f52fe34068d96f12bc35af5d7e51443f3c59e89627accd33f7ce54b8f1534a`.

Revised raw capture:
`captures/synthetic-1787923090868-16777.json.gz.base64`

- Encoded SHA256 `c03320d618b07011e93e6ca447d6a6ad1d1405bb4638f5aaad27bb1ef6d83520`.
- Decoded SHA256 `4f99fabc23192c23f7a954c4f750cfbca9e252109a4b72df5afcb603be58cf0c`.
- Decoded JSON1702070 bytes, below2MiB model report ceiling.
- All seven actually imported module URLs/hashes captured; pre/post complete seal checks pass.
- All37 model timers drained; owned in-memory model entries discarded. No OS fixture trees were acquired by these controls.
- Actual observer children0; native calls0; product imports0; real-driver instantiations0.
- Seven module syntax checks passed before revised execution; no global source/type/build/engine run.

The parent was existing Nodev22.22.2 Darwinarm64, canonical path
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`,112989184 bytes,
SHA256 `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
It ran synthetic JavaScript only. No Node child-control process was started.
RESULTS-v1 retains the bare-node exit127 setup failure and successful explicit-path
first28 capture. There were no failing semantic/native cases in this task because
none ran; no claim that metadata/model control passes are semantic passes.

## Five prior gaps: concrete control mapping

| Required correction | New executed model evidence | Limit |
| --- | --- | --- |
| Ownership before mkdir | post-mkdir inspection failure retains acquired/unbound path, zero launches; replacement/new entry preserved | Not hostile-ancestor or actual OS teardown proof |
| Timeout terminal settlement | missing-close and surviving-group settle at3000 virtual ms, report uncertainty, no next launch | Not an actual OS reaping/timeout guarantee |
| Complete final authentication | final module/auth/config/seal/row/runtime drift; extra module; post-persistence module/binary/new-module drift | Whole imported modules with injected dependency state; real driver remains unexecuted |
| Receipt-failure launch accounting | post-spawn persistence failure retains one observed launch, removed from remaining, closes or reports uncertainty | Not an executed real spawn-event timing proof |
| No fabricated close | sync throw and async no-process error have one spawn-call attempt, zero launches, zero close events | Later real Node error/close ordering remains separate |

Additional controls cover per-row/aggregate output, exact admission/binary checks,
late errors, empty cohorts, out-of-root receipt refusal, cleanup failure, stdin
errors, parent runtime identity, final receipt contents/new entries and repeated
faults. The200-callback overflow control observed maximum7 pending model timers,
not unbounded per-callback escalation. It fails safely with retained bytes<=65536.
Original five old-supervisor findings/captures remain unchanged; no old supervisor
code or old native cohort was reused. These37 are not product mutant kills.

## Native recipes and authorization boundary

Original32 are unchanged and unexecuted. Additive11 are unexecuted neutral data:
A01 actual C3 first-byte delimiter hit; A02/A03 exact2147483647 one/two-record
origin; A04 native2147483648 boundary; A05–A11 isolated failed forms and explicit
closed-u0 with before/status/after/remainder snapshots. Original N30 has no C3 and
must never be described as a delimiter-hit observation. No expectations/rescore.

The new CLI is `observer-v1/modules/cli.mjs`. It requires explicit absolute ROOT
authorization path/hash and module-seal path/hash. No ROOT_NATIVE_GO file exists
in this packet. Different reviewer first authenticates/replays synthetic modules;
ROOT then may separately select original32/addon11 IDs with the exact module seal,
recipe hash, existing Node identity and unique owned output root. The GNU binary
remains pinned by original SOURCE-BINDINGS: SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`;
its prior5.3.0(1)-release identity is historical, not a fresh invocation.

No actual harmless-Node child admission is requested for the completed synthetic
task. If the different reviewer needs OS driver validation, obtain separate finite
admission before running it. A synthetic model cannot establish detached process
groups, stream descriptor closure, native startup, or real hash-reader behavior.

Full final.json remains explicitly provisional. Authoritative returned/CLI output
follows complete post-persistence authentication. Evidence root/records are retained
in future native runs, not claimed cleaned; only empty verified fixture directories
are removed. Failed directory binding/new entries preserve data and report failure.
Synchronous bounded filesystem calls and observer crashes cannot guarantee durable
completion; unknown groups are reported, not falsely reaped. No PID/ETag/ancestor
ABA protection is claimed.

## Product design decisions still needed

ROOT's `-u0` effective-shared-stdin and pretarget known-closed refusal are recorded
in ADDENDUM-v2; other FDs/-C/-c remain pre-pull/pretarget refusal. Producer.next
errors remain opaque and cannot be pre-detected. Counts/extras/UTF8/NUL/origin and
clearing/publication phases await native observations and final policy.

The exact proposed private ownership mapping is in ADDENDUM-v2: terminal dispatch
normalizes raw middleware stdin ONCE under that invocation's registered owner,
then forwards the canonical ShellInput into child IO/context/invoke. Borrow existing
views; never cache raw objects globally, return a borrowed parent at-n, or create
a new budget. A physical record/EOF distinction and ledger-accounted raw record
lease are prerequisites, not existing APIs. Canonicalization must not silently
change ordinary read decoding or accepted cleanup/error precedence.

One remaining concrete ROOT choice is producer reentrancy: recommend a private
asynchronous-causality token around host next, rejecting same-cursor nested reads
while permitting independently started sibling queueing. This needs an approved
mechanism and tests; a busy boolean does not distinguish them. Alternatively keep
same-cursor producer recursion explicitly unsupported with caller cancellation as
escape. Neither behavior is implemented or claimed proved here. Shared leases
necessarily span host next; they must not span extra shell callbacks/diagnostics.

G4A P/E_input/post-transfer formatting accounting remains separate; no claim of RSS
bounds or a new global budget. Array acceptance is a product-mapfile prerequisite,
not an oracle-preparation prerequisite. No mapfile/readarray builtin exists from
this task. Original13/54 and47/54 remain untouched.

## Bounded replay

From the repository root, with the exact committed modules and seal:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/shell/mapfile-design-20260828/observer-v1/modules/synthetic.mjs
```

This creates one unique capture only in this owned subtree. It does not interpret
the43 scripts. Preserve every capture and its source-seal identity; do not run the
native CLI without subsequent ROOT admission. No active task child remains.
