# RegexWorker / DU source analysis — partial, UNSAFE_STOP

Date: 2026-08-29. No product/comparator evaluation, Worker, probe, native oracle,
network, build, install, private access or policy implementation occurred.

## Stop and losses

The source-only `public80-policy` Git action combined three blobs, including the
large `SOURCE.json`, into one stream. It exceeded the helper's sealed 65,536-byte
per-stream cap. This was a preparation/capture defect, not a product finding.
`STOP.json` retains the exact action: PID79675 closed on SIGTERM; 136,788 stdout
bytes observed, 5,716 retained, **131,072 observed bytes irrecoverably unretained**.
The retained bytes are not claimed to be a complete contiguous source artifact.
No reconstruction, retry, alternate route or dependent source analysis followed.
Both capture descriptors were synced/closed. All13 Git children had close events:
10 exit0, two exit128 metadata mistakes, one SIGTERM capture stop. No analysis
child remains. Tool-host retirements and publication accounting are separate.

The two earlier exit128 actions mistakenly treated `af99d459` as a Git revision.
The later authenticated Plato report identifies it correctly as execution-seal
SHA256 `af99d459a60679a7e0b466eabbcfbf8bf841c0da8ac25d8b27e1d2b7a839d808`.
Those original failed metadata actions remain recorded, not rescored.

## Established source facts, not actual argument identity

Pinned target: `67eab12e315054907ef4ef435c6bbca2f59e0c36`;
declared whole858 package SHA256
`6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
This analysis did not complete independent package/compiled-closure matching.

- Authenticated `src/commands/regex-execution/client.ts:79` constructs a Worker
  with `new URL(...)`, installed entry `./worker.js`, `execArgv: []`, and two
  resource-limit values from the validated executor options. The source `.ts`
  route uses a separate dist-relative expression; it is not permission to admit
  that route in installed/moved consumers.
- `client.ts:36` registers session cleanup before opening it. Retirement awaits
  `worker.terminate()` unless exit was already observed, and removes listeners.
  The executor has a slot count cap; cumulative creations are NOT bounded merely
  by that concurrency cap. Sessions/retirements must be counted separately.
- `worker.ts` imports `node:worker_threads`, `./matching.js`,
  `../expr/bre-worker.js`, and `./protocol.js`. The expression-worker transitive
  closure has not been authenticated in this task. Four source captures are
  complete and hash-bound in `STATE.json`; that is not a complete executable
  closure or an actual asset-load witness.
- Read-only `executor-v3/offline.mjs:98` replaces every application Worker with
  the categorical `UNSUPPORTED_WORKER_ASSET_ADMISSION` refusal. The captured
  prior invocation records only `argument: "object"`; its brand/contents remain
  UNKNOWN. A source URL expression does not identify that actual argument.
- The public80 reports distinguish backend loader capability from guarded
  application Workers, acknowledge source-only real-closure qualifications, and
  do not supply general application Worker authority. Public80 uses another
  candidate/package. No equality to its bytes or RUN02 observer was established.

## DU: hypothesis only; classification unfinished

Original operations7/9 remain two FAILs: status1, empty stdout, exact diagnostic
`du: "data.txt": allocated bytes unknown; total suppressed\n`. Comparator8's
status0/output `2\tdata.txt\n` remains unchanged. The captured frozen specimen
declares file bytes; that alone does not establish allocated storage metadata.

Authenticated old DU source chooses `stat.allocatedBytes` in non-apparent mode
and treats undefined/invalid allocation as unknown. `FileStat.allocatedBytes`
is optional; zero is distinct from absence. This supports an UNKNOWN/profile-gap
hypothesis, not a completed finding. The actual adapter, fixture stat provenance,
multipart raw receipts and complete memory-FS write/stat path were not reconciled
before STOP. **Known allocated-data failure has neither been demonstrated nor
excluded by a complete investigation.** Do not change the oracle or fixture.

## Minimal proposal / fresh-review barriers (NOT a sealed allowlist)

1. Source-only continuation must bound each blob by metadata before capture;
   large JSON should use a separately bounded DATA reader, not concatenate into
   a 64KiB child stream. Preserve this stop/loss; fresh ROOT permission is needed.
2. Authenticate exact compiled old-target client/entry and complete recursive
   import closure, modes and installed/moved identities. Compare each byte hash
   against the qualified policy and RUN02 observer. A mismatch needs a new
   candidate-specific design, not inherited acceptance.
3. A future guard must validate genuine URL brand without getters/coercion,
   exact canonical admitted entry (no query/fragment/data/eval/alias), finite
   own-data options, empty `execArgv`, and exact resource limits before creation.
   Keep every other guard; refusal must be sticky even if product code catches it.
4. Bind any nested loader/observer explicitly: empty product `execArgv` cannot
   silently become a preload permission. Require actual nested asset-load
   receipts, constructor attempt/creation/error/exit/termination reconciliation,
   pending-at-settlement checks and cleanup-fault preservation.
5. Derive a per-identity cumulative/active internal-Worker schedule from all33
   frozen programs before activation. Separate99 outer OS case workers from
   internal RegexWorkers and loader threads. No numerical internal cap is yet
   justified; existing336 OS cap cannot be assumed to cover a new topology.
6. Proposed finite preexecution control groups: exact entry/closure; URL brand
   and alias negatives; own-data options; forbidden eval/data/execArgv; pre-eval
   drift refusal; sticky caught refusals; cumulative/active exhaustion; actual
   nested load witness; startup/error/abort/termination cleanup; missing/extra
   lifecycle events; installed/moved-origin refusal; DU unknown/zero/known
   metadata qualification. These12 groups have **zero frozen instantiations or
   executions** here; they are requirements, not an accepted control packet.

## Immutable history and next blocker

Prior `fae32e768651adbb54cb31abf2848aa7a42e2ad2` /
`4009eaf17560333b807eb8a04664a73a138f3a27`: seven oracle passes, two DU mismatches,
op10 capability refusal,89 unlaunched/raw-unrun90; attempts10/fulfilled10,
setups7/fulfilled7 versus legacy9/6 remain unchanged. Capture, natural/postflight
qualifications, V6/N02 losses, W03/W07 gaps and consumed grants remain unchanged.
No current-product defect, semantic acceptance, security parity or winner claim.

Remaining blocker is a fresh bounded SOURCE/DATA continuation after this capture
stop, followed by an exact candidate-specific policy/control seal and independent
review. No runtime admission is proposed as ready by this partial handoff.
