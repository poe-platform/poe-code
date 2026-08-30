# Timeout78 public author handoff — different review required

## Exact candidate, not moving HEAD

- Product candidate: `67eab12e315054907ef4ef435c6bbca2f59e0c36`.
- Tree: `2b8110a17559ba1ddbc94b9b8ac619e9dda00d40`.
- Base: accepted coherent77 `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
- Accepted unchanged timeout module: `a23867d6a42e1cb2f2e7278cf22061737a4bea9d`.
- Public source: `382abba5a73ddad13ba424bafbe1992b4f7ca7e9`.
- Full npm tarball SHA256:
  `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
- Tarball: 749907 bytes, 858 regular package files: 856 emitted files plus
  package.json and the exact baseline README. Manifest SHA256:
  `b8475443860bfb0513a87cf6970ce2953e1858f27911ad3854e55f69ff22aa12`.
- Actual retained tarball:
  `/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/timeout78-public-author-v3-WzysEq/pack/virtual-bash-0.0.0.tgz`.

`CANDIDATE.json` binds all seven changed product paths: four module files from
a238 and only `src/index.ts`, `src/plugins/index.ts`, `package.json` from382.
No WebDAV/XAN, other live runtime, lockfile, or dependency changes enter. The
selected build inputs are271 authenticated files, not a full historical archive.
Zero runtime dependencies; existing Node>=22 requirement unchanged.

The candidate is synthetic, not a new branch/ref. Its raw commit body and exact
tree/source entries are retained. `RECONSTRUCTION-CHAIN.json`, `reconstruct.mjs`
and `evidence/RECONSTRUCTION.json` prove the four synthetic ancestors/candidate
were absent, then reconstructed exactly in two fresh object stores (including a
space-containing path), from reachable tree/selected-blob anchors. This is
selected build/provenance reconstruction, not a claim of full historical object
closure. No instruction checkout/materialization, history rewriting or new refs.

## Stable API and policy

Root and explicit `virtual-bash/commands/timeout` export the same factories:

```ts
createTimeoutCommand(options?: TimeoutCommandOptions): CommandDefinition;
createTimeoutCommands(options?: TimeoutCommandsOptions): readonly CommandDefinition[];
timeoutCommands(options?: TimeoutCommandsOptions): VirtualShellPlugin;
```

Types: `TimeoutCommandOptions`, `TimeoutCommandsOptions`, `TimeoutScheduler`.
Aggregate: `AgentCommandsOptions.timeout?: Omit<TimeoutCommandsOptions, "replace">`.
Only `invoke`, `scheduler`, and `maxTimerMilliseconds` are forwarded unchanged.
Unknown runtime nested `replace` is ignored, including an accessor; top-level
replacement and collision preflight remain authoritative. Direct API unchanged.

`context.invoke` property presence wins; explicit undefined means unavailable,
not configuration fallback. A configured fallback receives no object receiver;
the context method retains its context receiver. Scheduler methods retain the
original scheduler receiver. Aggregate `execute` is not a new timeout fallback.

78 independently listed default names are in `names.mjs`; `getopts` is a builtin,
not an extra plugin. Curl/SafeJS stay optional. Timeout is a cooperative deadline,
not native-process control or hard preemption. Zero duration acquires no timer;
positive deadlines register cleanup before timer activation and await owned child
cleanup. Caller/foreign errors are not turned into deadline status. The module's
accepted diagnostics, duration parsing and refusal profile are unchanged.

## Actual author observations, separate cohorts

| Cohort | Actual result and qualification |
| --- | --- |
| V1 build/pack + maintained fixtures | Build/pack succeeded;82 pass/1 fail: exact suffix omitted timeout. Later public phases unrun. |
| V2 maintained/public |83/83 maintained;12/13 installed Node22. New author test compared a registry clone to its input object. Later phases unrun. |
| V3 build/pack/consumer |83/83 maintained;13/13 installed Node22 and13/13 Node24;4 positive types. T08 rejected with2561 instead of frozen2353; later phases unrun. |
| V4 package-only setup |0 consumer commands: author read inventory `type` instead of `kind`;0!=858 admission failure preserved. |
| V5 separate package follow-up | Same V3 tarball, no new production build.13/13 installed and moved on each Node22.22.2/24.11.1:52 executions, no failures/skips/TODOs. |
| V5 strict consumers |4 positive +6 exact negative payloads per layout;20 executions, qualified T08 diagnostic below. Root/contracts/timeout declarations resolve to the one installed package. |
| V5 other controls | Full maintained stream-five21/21;2 actual source-read permission denials;3 missing root/contracts/timeout entrypoint refusals. |
| Separate assertion/export controls |4/4, including two detected assertion mutants;2 null-export manifest refusals. Not product source mutants. |

All858 package files are authenticated against actual emitted files/candidate
README/manifest before consumer execution. Source/package/dependency/tool
inventories stay unchanged before/after, including unexpected-entry detection.
All supervised children close naturally and are reaped; no timeout/kill retries.
Node22/24 binaries, Git/tar, TypeScript5.9.3 and dependency identities are retained
in raw receipts. Permissions remain enabled for public runtime consumers; this
is source-fallback fencing, not an OS sandbox certification. No actual native or
SafeJS execution and no whole gate. These counts are not Raman's30-case review.

### T08 needs independent diagnostic qualification, not an API fix

Original frozen payload remains byte-identical:

```ts
const options: AgentCommandsOptions = { timeout: { invoker: async () => ({ exitCode: 7 }) } };
```

Actual pinned compiler rejects at `T08.mts(2,52)` with TS2561 and:
`Did you mean to write 'invoke'?`. Frozen2353 expects the same unknown-property
category without the spelling suggestion. V5 author-only version requires the
exact2561, location and original message terms plus the suggestion; it does not
accept a broad nonzero diagnostic. Raman's files remain untouched. Original V3
failure is retained and is not relabelled as an unchanged10/10 type freeze.

### Maintained fixtures and documentation

Five maintained current files are enumerated in `FREEZE.json`: agent registry,
split, stream-format contracts, stream-inspection public, stream-five consumer.
The baseline agent test was maintained76 missingwhich, not sealed historical data.
Original18 hunks are committed33d9c1cd; extra exact suffix member is bcb6481e.
`FREEZE-V2.json`/`FIXTURE-AMENDMENT-V2.json` preserve the first failure and exact
one-line change. The attempted machine preseal had a syntax error; amendment
metadata is honestly post-fixture/pre-V2, not a fabricated pre-code freeze.
No historical profiles or unrelated semantics changed. Public author assertion
V3 compares actual pre-install registry entries; original12/13 and two stronger
assertion-control failures are preserved separately.

Current root README87c58987 documents timeout78 and the cooperative examples.
It is a separate documentation delta, NOT part of this exact seven-path package
recipe; packed README remains baseline5137. Module README's earlier pre-public
wording is historical, not a claim this package lacks the new public API.

## Reviewer routing

Raman freeze031d4ddf / preparation58de5502 remains unchanged. Use `CANDIDATE.json`
for three public blobs and four module blobs, `evidence/PACKAGE-FILES.json` for
all package members/modes/hashes, and the raw commit/reconstruction chain. Bind
the eight independently frozen mutant classes to these actual bytes before
execution; no author source-mutant success is claimed. Please separately judge
T08's exact diagnostic profile, the19 maintained inventory hunks and author
registered-entry correction. Candidate product bytes did not change during any
of these author fixture iterations.

Source executor V3:30c8629f; fixture suffix:bcb6481e; package-follow-up V5:8c54edee.
`evidence/RAW-INDEX.json` authenticates original reports/stdout/stderr as bounded
gzip/base64 data, not source snapshots. `evidence/SUMMARY.json` is the compact
machine handoff. No global typing/release/superiority claim. The separate fixed
f5/c109 projection driver remains under different review and needs a fresh root
release; timeout never changes that candidate or authorizes a full gate.
