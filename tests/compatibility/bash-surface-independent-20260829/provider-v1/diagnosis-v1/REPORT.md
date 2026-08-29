# Readiness-only diagnosis: bounded result

Source/preseal commit `2200e564436395450b4200b429574c52703f442d`; PRESEAL SHA256 `6e04e87087f3108b5bf1ed312fe0c3ec02f16c079cccb0f9af595350d6bc55c7`. Exactly TWO newly named controls attempted once. Original F01 and15 unrun provider fixtures are NOT replayed/rescored. Native9/40 remain UNRUN.

## Observations

| Identity | PID | Raw stdout/stderr/events bytes | Status/signal | Closure |
|---|---:|---|---|---|
| D01-unfenced-readiness |93673|26/0/0; exact `PROVIDER_DIAGNOSTIC_READY`+LF|0/null|exit+close+3EOF; group absent; capture FDs closed|
| D02-original-fence-readiness |93674|0/0/0|null/SIGABRT|exit+close+3EOF; group absent; capture FDs closed|

Controller93672 exited1/closed. No timeout, TERM/KILL intervention, capture failure or unresolved known direct process. D02 abortion closes dependent target admission; no retries/variants. Recorded23-entry historical fixture namespace and original profile remained unchanged. Profile SHA256 `f0c96a5833d751c7b1ca194094390d75f91fe7c2286920c8eb3c4163afd2c58d`/5745 bytes. Both launch requests use the same pinned Node22.22.2, exact --eval literal, configured6-key fresh env, owned F01 cwd and4 stdio channels. The fenced launch adds only sandbox-exec -f with those original bytes. No target imports, explicit file calls, child launches, network API calls, Bash or product work.

## What follows—and what does not

The pinned runtime/literal/configured env/cwd can emit readiness unfenced. The new fenced composition still aborts without readiness, even without importing fixture.mjs. This narrows the association away from requiring F01 fixture operations; it does NOT identify the aborting loaded image, a permission check or the exact failure instruction. Empty capture is not proof Node never reached the write. No host crash/unified logs or denial trace was read.

SOURCE-COMPARISON.md binds the immutable38a4e7b reference: it uses a DEFAULT-ALLOW write fence, Node24 and differing env/preloads. It is not a working equivalent of this default-deny read/exec/network profile. Its own polling/image-origin limitations remain. Copying allow-default would be an unjustified broadening.

## Minimal next decision, NOT a repair claim or GO

No specific startup-library/sysctl permission is justified by these two observations. Primary pinned Node/libuv source adds one concrete transport hypothesis: the Unix `UV_CREATE_PIPE` path uses `uv_socketpair(SOCK_STREAM,...)`. Current capture uses that path while the profile denies network operations. This is SOURCE reasoning, NOT proof that Seatbelt blocked the inherited sockets or caused SIGABRT. Reference: https://raw.githubusercontent.com/nodejs/node/v22.22.2/deps/uv/src/unix/process.c (uv__process_init_stdio). No target socket/connect test was run.

Recommended next bounded experiment requires a NEW ROOT decision: retain the same readiness literal and all library/exec/sysctl/network restrictions, but use two owner-created exclusive regular output FDs for stdout/stderr. Proposed additive fence exception is ONLY `file-read-metadata` and `file-write-data` for these exact two future owned paths:

- `/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1/stdout`
- `/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1/stderr`

Exact proposed additive clauses, NOT applied:

```scheme
(allow file-read-metadata
  (literal "/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1/stdout")
  (literal "/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1/stderr"))
(allow file-write-data
  (literal "/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1/stdout")
  (literal "/private/tmp/safe-bash-surface-provider-capture-diagnostic-v1/stderr"))
```

The owner would pre-open/identity-bind those two regular0600 files in a fresh0700 directory, pass only their FDs, and retain outer capture/exit/close/group ownership. No child pathname opens, broad read root, network permission or library exception. The variant profile would be NEW/versioned, never overwrite F01.sb. A fresh finite recipe must also state regular-file capture/size sampling limits; this is not pipe EOF/backpressure acceptance. It could distinguish a capture-transport-sensitive failure, not by itself certify the provider. These paths/files/rules have NOT been created or executed. Alternatively ROOT may decline further execution and commission narrowly authorized startup-denial provenance; existing grant permits neither host logs nor permission widening.

## Accounting and retained boundaries

Fresh20min/32 ALL processes/peak3/64MiB capture/256MiB work. Pair caps:3s active +TERM2s/KILL1s per target,20s cohort,64KiB/channel,1MiB capture,16MiB scratch. At raw archive boundary:15 observed administrative/controller launches +2 observed targets=17 known launches, known peak3 including outer controller. All known launches exited/closed; no all-kernel descendant census. Publication children after that boundary are preserved in the outer capture and final checkpoint, not disguised as target tests. Logical capture/scratch are not RSS or hard post-kill guarantees.

No old provider/priority/native43/fullgate budget reused. Both actual roots and raw evidence are retained; no known active process. Full raw argv/env/chronology and frozen reference objects are in RAW-CAPTURE.json.gz.base64. Zero repair implementation, nativeBash/version/native9/40/product/compiler/install/Worker or network-connection/listener probe.
