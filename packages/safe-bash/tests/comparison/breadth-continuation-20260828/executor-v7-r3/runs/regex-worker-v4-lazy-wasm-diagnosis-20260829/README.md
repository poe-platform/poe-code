# Final SOURCE-only lazy-WASM diagnosis — 2026-08-29

## Adjudication

**The sealed guard contains a source-proven avoidable initialization trigger: reading the lazy global WebSocket while attempting to replace it.** This is not a new runtime reproduction or a recovered constructor trace.

The exact local chain is offline.mjs:30-32 (value read), :100 (WebSocket replacement), then :115 (WASM denial installation). The pinned Node22.22.2 source exposes WebSocket through a native lazy data property; retrieving it synchronously loads Undici. In contrast, global fetch is an ordinary data function whose implementation loads Undici only when invoked. The guard does not call fetch here; Request is not its triggering read.

Official Node release commit **2645dc73720b1b4f27c49f395d3c66025ce126cc** supplies the primary source. Its Undici Node entry imports global dispatcher/Agent/Client/client-h1 at module initialization. client-h1 immediately starts lazyllhttp: compilation begins synchronously, while instantiation follows an await. The installation can therefore finish replacing WebAssembly APIs before the pending continuation looks up instantiate. The retained refusal and lazyllhttp stack match this route; a network request is not required by the source chain.

The llhttp promise is module-owned, not the harness body's awaited promise or registered cleanup. Its bare catch call supplies no rejection handler. Under the sealed strict unhandled-rejection mode, this supplies a source explanation for failure outside the operation's try/cleanup-to-EARLY path. EARLY is currently emitted only after body and cleanup. We did not invoke any getter, compile, instantiate, HTTP operation, Worker or fixture to test that explanation.

## What remains unknown

The captured stack does not identify the initial property read, prior initialization state, exact continuation ordering, or main-versus-nested thread. We establish the source trigger and its compatibility with the failure, not exclusive runtime causation or a new measured WASM allocation claim.

The config and empty journal cannot prove native Worker entry. observer.mjs creates both files at70-72, before its in-memory attempt count at77 and native constructor at89. EARLY/RESULT remain absent. Attempts, created count, peak and retirement remain **UNKNOWN**. Raw completed-created0 remains unchanged; no parent durability or nested load credit is added.

## Smallest proposed route — UNRUN

Prefer a separately named trusted-host profile using public **--no-experimental-websocket**, not a guard relaxation or warmup. Node startup source deletes that global before user modules. Apply it explicitly to each case child and, subject to qualification, each observed Worker. Keep requested execArgv[]; separately bind the new effective flag plus observer preload. This requires versioned argv/assessor/profile receipts and ROOT review. It reduces available globals and is not stock Node or unchanged instrumentation. Permission Model, WASM/network/fs/process refusals, token/4-byte-SAB channel, env, workerData and transferList stay unchanged.

Do not substitute a generic descriptor-first rewrite: the pinned V8 source allows descriptor inspection of native lazy data properties to obtain their value. That approach is not proven free of this initialization side effect.

FUTURE-PROPOSAL.json contains six finite proposed qualifications (maximum one harmless Worker), all **UNRUN**. No successor code, active authority, warmup or permission change is supplied. A parent-only flag is insufficient evidence for the nested profile; forwarding and startup order must be qualified separately.

## Bindings and boundaries

LOCAL-BINDINGS.json authenticates45 local source/tool/capture dependencies; the759-byte stderr also matches its stored Git blob in86d15047. PRIMARY-SOURCES.json records18 official source/release locators and the immutable Node commit. Online text was inspected through the web service, not downloaded into an executable tree or assigned an invented raw-file digest. This is not a rebuilt/extracted-binary equivalence proof; rendered web line numbers are not substituted for raw stack offsets.

Historical full55 STOP remains G01.1/54UNRUN/0qualified,931 bytes retained,3 runtime OS roles closed, nested lifecycle unknown. All earlier capture losses and STOPs remain immutable. New work is SOURCE/DATA only, no Node child/Worker/runtime probe; administration uses bounded Git metadata and explicit-path publication.

**Comparison track pauses after this packet.** No further runtime work is authorized; ROOT decides whether to revisit it after coherent product/native Bash compatibility priorities.
