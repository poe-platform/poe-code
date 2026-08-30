# Future write-set and loader authority — NOT implementation GO

## Preferred smallest additive transport window

Propose new siblings under src/commands/regex-execution, not inside Plato's five-file engine ownership:

- ere-transport-types.ts: separate EreTransportRequest/Reply/Result plus private session/root types; import exact engine EreUsage/EreLimits/EreFragment/EreSpan, no duplicate names.
- ere-protocol.ts: finite own-data request/reply/counter/capture validation and five-field result adapter. No edits to legacy protocol.ts.
- ere-client.ts: inert preparation, bounded ERE-only queue/slot ownership and private root/session lifecycle; only explicit internal callers. Existing RegexExecutor/RegexSession methods remain byte-for-byte unchanged.
- ere-worker.ts: fixed static Worker entry; validated shell-ere only; same-instance compile/match/ledger and exact reply snapshot. No import/use of matching.ts JS RegExp or expr/bre-worker.ts as matcher.
- ere-ledger.ts: parent reservation book and live transport ownership; coordinates worker-local source-defined EreLedger usage, never clones remaining budgets per session.

This is an additive peer in the existing regex-execution subsystem, deliberately not a retrofit of the existing class's private Slot/Pending state. If ROOT requires the same RegexExecutor class/pool, first approve a separate broader write-set: additive openEre/requestEre APIs plus private mixed dispatch and both pool disposal ownership, with explicit legacy declaration/behavior proofs. Do NOT silently do that refactor under this sidecar. No method currently accepts ERE, no custom executor/factory exists in public RegexExecutionOptions, and a public execute callback is not such a factory.

Freeze existing src/commands/regex-execution/{client,protocol,worker,matching}.ts, expr/**, src/index.ts, package.json, public contracts/options/default inventory. No new root/package export or runtime dependency. New internal d.ts files will still ship via files=dist and are observable to absolute-file consumers; do not call them unobservable private API.

## Separate held runtime window after accepted N14 + ROOT GO

- New src/shell/ere.ts: private WeakMap<Budget,EreRootOwner>, root/session attachment, operand/result bridge; no Budget fields or arbitrary context hook.
- src/shell/shell.ts: create/register inert root at accepted fresh Budget/InvocationScope boundary, root disposal before final settlement.
- src/shell/runtime.ts: use shared Budget identity for ERE descendants; quote-preserving operands and atomic capture writer remain runtime-owner changes, not this task. No new shared limit keys/counter resets.
- src/shell/conditional.ts: reached =~ route and exact2/3/0/1 mapping with unhandled private-limit propagation through boolean operators.
- Any array writer helper changes require exact existing ledger/staging API review and separately declared paths. No fabricated source replay or speculative parser/AST change.

Accepted-source anchors: shell.ts165-186 root Budget/scope/close+selection; runtime.ts957/1391/1985/2488 same Budget forwarding,2007/2506 registerCleanup; cleanup.ts child/register/close seals admissions then drains callbacks/children. Current N147196bace is pending and excluded from this source base. Final implementation must bind its later accepted composition, not apply stale runtime line edits blindly.

## Static Worker and asset closure

Current client.ts78-88 uses new Worker(static URL) with execArgv:[] and resourceLimits; no workerData/env/stdout/stderr overrides. Existing client source fallback targets compiled dist/commands/regex-execution/worker.js; it is not raw TS Worker execution. Current worker.ts emits ready and accepts legacy/expr operations, importing matching.ts and expr/bre-worker.ts. No existing custom observer API.

Proposed ERE entry URL is fixed relative ere-worker.js in emitted installed files. Source-labelled qualification must build that exact adjacent asset and record actual loaded emitted hashes; no moving dist or guessed package deep import. WorkerData is exactly {operation:"shell-ere",version:1}, no env/caller context/AST/engine code, no eval/generated source/SHARE_ENV/native process. No engine/session handle crosses structured clone. Empty env is a proposed ERE-only authority restriction, NOT a change to legacy workers or inherited qualification.

Worker execArgv policy is explicit: default[] only if qualification proves the exact static closure by separately admitted Worker-side bootstrap observation. A required loader/bootstrap uses sealed literal absolute/relative module paths and exact hashes, not ambient process.execArgv, NODE_OPTIONS or a blanket --allow-fs-read. Existing parent loader hooks do not automatically see Workers with []; no claim otherwise. The ERE entry should own stdout/stderr (or prove silence under a separately approved profile); any capture option/new bootstrap capability is a new admission item, not approved by old regex or Node/SafeJS tests.

Expected source-defined new builtin edge: ere/limits.ts -> node:timers/promises for cooperative checkpoint; Worker entry/host -> node:worker_threads. A new validator may need node:util/types.isProxy; seal exact importer->builtin edges before loading, not a global allowlist. Engine five-file graph needs full actual emission/declaration/copy census; this sidecar reads only three files and author handoffs, so it does NOT claim that full graph authenticated here. No compiler/Worker or native run occurs now.

The preferred sibling entry keeps old expr Worker assets/flags/entrypoint unchanged; it still increases whole-package file count. Full package and moved-loader profiles must be versioned with actual new emission names/hashes and no source fallback. No guessed new full-pack count/hash. Existing accepted954/expr evidence is inherited, not rerun or rescored.
