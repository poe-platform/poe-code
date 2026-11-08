# Node-local API v2: ownership and interpreted bridge

Date: 2026-08-29. SOURCE preparation only; no compiler, provider, Worker, guest or package validation has run. This supplements API-v1.md and CONTRACT.md without changing NP1-CJS-WRQ-L-SYNC-1, the grants, numerical caps or shared core.

## Corrections and origin

API-v1's phrase "all eight own fields" is a prose count error. NodeHostRequest has exactly SEVEN fields: sequence, op, authority, path, flag, text, moduleKey. Its original declared fields and types are unchanged; no eighth field is added.

Inert prepare may only inspect request data and the signal and return callbacks. request/delivered/reserve/cutoff are inactive until start. The parent enrolls the entire asynchronous request, not only individual VFS awaits, so retirement cannot overtake pending response reconciliation. delivered after normal cutoff is permitted only for a previously admitted pending response. A provider must cease all callbacks before its retirement promise resolves.

Raw origin is recorded at source-reader, stdin-producer, provider-prepare/start, FS-rejection and sink boundaries. A host-origin NodeProfileError or NodeUsageError remains the exact escaping reason; its class is NOT permission to map it to status2. Internal profile failures are marked separately. Caller signal reason wins at final settlement; escaping execution overrides local profile failure; cleanup-only failure is raw even undefined. FsError transport is allowed only inside an actual bound FS operation. An unacknowledged transported FS error is reconciled with its original reference even if terminal is missing. No equality comparison infers origin.

The owner checks a completion/retirement contradiction both when start completes and when close finishes: entryReturned/guestFailure cannot coexist with proved-no-acquisition. Synthetic tests must not label fabricated exited records as actual Workers. The command cannot independently prove a dishonest trusted provider's exit record; provider qualification must bind its actual owner/entry/exit implementation.

## Exact interpreted-program bridge

request.program is module-generated interpreted text, NEVER a native module/eval/Function. Its user source is admitted first. A provider using this builder supplies two private bindings, __vnodeBridge and __vnodeContext. They are not guest parameters. Every user identifier is decoded and the reserved __vnode prefix is refused. No public engine deep import is implied by these names.

__vnodeContext has selector, argv, env, cwd, filename, directory. argv/env are independently copied INTO guest values for each invocation; host object reuse is not a guest identity proof. filename is the selected virtual name; directory is entry dirname for .cjs, otherwise invocation cwd. Only file entries receive __filename/__dirname. The guest receives only the declared facade values. Context mutation must never mutate the host or siblings.

__vnodeBridge always receives six primitive/null arguments. It is a provider-owned genuinely SYNCHRONOUS guest host-function bridge; returning a Promise for an FS result is not conforming.

|First argument|Remaining five arguments|Required owner action|
|---|---|---|
|entry|null,null,null,null,null|One proven wrapper-body entry marker, separate from engine-attempt count; no VFS/stdio effect.|
|printRefusal|null,null,null,null,null|At most one trusted print-result refusal after entry; profileFailure provenance, not a guest error-code comparison. No output is admitted.|
|delivered|postcopy-v1, canonical positive decimal sequence string, response kind, null,null|Validate against the current response; call services.delivered only AFTER guest-owned copy. Transport ACK alone is insufficient.|
|authorizeModule / authorizeJson / readText / writeText / writeOutput / path|authority,path,flag,text,moduleKey|Assign next sequence, validate the exact API-v1 request, await parent work through the provider's blocking transport, return a serialized finite NodeHostResponse string synchronously.|

No other action is admitted. The bridge and parent may hold only the declared bounded records. Event counters do not create new shell-command charges or reset a shared Budget. Normal admission cutoff remains entry-return lifetime retirement, not an all-Promise-jobs-settled promise. A provider may implement an equivalent independently qualified facade instead of this builder only if it satisfies the same source/request/profile contract; it cannot silently ignore request.source or claim this program's load identity.

The combined interpreted program (trusted facade plus user source) is checked against the existing256KiB engine-source maximum. This is a combined admission ceiling, not a guarantee that every raw256KiB user source fits with the facade. Parser logical reservation is released before provider acquisition. Source collection counts at most100000 borrowed producer pulls using the existing work cap; it never returns/disposes the borrowed iterator. Credit accounting is command-owned logical admission, not measured native allocations or RSS.

## Observation

The module-local diagnostic publisher inspects only bounded own-data name/message/code descriptors, rejects Proxy observation, leaves accessors unread and retains publisher-fault presence/value separately. Its trusted caller must already hold the1MiB diagnostic reservation. The publisher's returned fault record must be consumed by the provider's terminal/journal; a discarded return is not diagnostic success. Diagnostic serialization never reconstructs raw identity or converts a control/sink reason into a guest error.

## Remaining reference-provider qualification

PUBLIC95 bb23 source exposes string and array members beyond the closed NP1 inventory. The module-owned parser validates syntax, not runtime member kinds or all process.env assignments. These remain explicit qualifying-provider obligations already stated in API-v1. A bare public run binding is NOT thereby qualified. No engine patch, widening, guessed parser import or whole-provider success is claimed. A finite test adapter can establish named workflow mechanisms only until this gap is closed by a separately bound conforming implementation.
