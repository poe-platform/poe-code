# Prospective owned-output production source rebase

August 27, 2026. **CONDITIONAL WRITE-PATH PROPOSAL ONLY — NO PROMOTION OR
APPROVED OWNERSHIP.** This delegated leaf inspected public Git bytes and wrote
only this new evidence directory and regular TMP files. No product patch,
getopts implementation, runtime edit, build, test, install, network request,
private-repository access, or actual SafeJS execution occurred.

## Frozen comparison and result

- Public HEAD frozen at the first command:
  `53f2a4681cd22a65299576ba655cf9338c3d1de0`.
- Its Git tree: `7fb1fc3b54596ec936e7f16ae462e1366ec3dc9e`.
- All current-source comparisons use that commit's blobs, never moving working
  files. At that observation there were no tracked dirty files or staged changes;
  eight unrelated untracked directory entries are recorded in `MANIFEST.json`.
  They are not committed-source inputs. HEAD subsequently advanced during this
  investigation; that neither repins this proposal nor certifies the later HEAD.
- **Nine likely source write paths: eight existing files and one new file.**
  Two existing documentation paths are conditional additions to the write scope.
  None is authorized for this worker. ROOT must allocate implementation,
  contracts/barrel, documentation, and acceptance ownership before any work.
- The complete S1/current `src/` comparison has 53 differing/one-sided paths.
  This is an exclusion/preservation inventory, **not** a 53-file rebase proposal.
  The historical 213 and current 237 `src/` entries include source documentation;
  they are not counts of TypeScript-only inputs or accepted tests.

## Exact likely source write paths

`required-likely` means needed **if ROOT later authorizes this feature**, subject
to current-source design/contract review. Line numbers below refer to frozen
current blobs; historical hunk identities and all before/after/current hashes
are in `MANIFEST.json` (`inspection.deltas` and `inspection.pathEvidence`).

| Exact path | Status / file operation | Prospective section and reason | Ownership coordination |
| --- | --- | --- | --- |
| `src/contracts/io.ts` | required-likely / modify | `ByteSink` at 6 and `createBytePipe` at 27 currently have no owned-output capability or consumer-close signal. Reconcile the V1 optional capability and abort/write wiring; preserve existing owned byte copies, backpressure, failure and close behavior. | Contracts owner; source implementer only by ROOT assignment. |
| `src/contracts/output.ts` | required-likely / add | Absent at frozen HEAD. V1 supplies the operation helper; final S1 adds child operations. Review against the existing cooperative-admission/cleanup contract, rather than copying the historical file as an approved implementation. | Contracts owner and lifecycle reviewer. |
| `src/contracts/index.ts` | required-likely / modify | Existing barrel has no `./output.js` export. Historical feature adds that star export; root already forwards this barrel. | ROOT-assigned integration/barrel owner, not an independent source-worker assumption. |
| `src/shell/runtime.ts` | required-likely / modify | `Budget.sink` at 85, `signalSink` at 231, pipeline `pipeOutput` at 335 and finalization at 378. Preserve and account for capability forwarding; reconcile the narrow completed/written-controller finalization delta. Do not overwrite current dispatch, environment, shebang, state, or cleanup logic. | **Direct getopts file overlap**; ROOT must serialize or assign disjoint hunk ownership with Poincare before implementation. |
| `src/shell/shell.ts` | required-likely / modify | External sink/capture adapter at 115 currently drops the proposed capability. Preserve capture and output-budget accounting on its owned write route, without replacing exec/dispose settlement or state initialization. | Shell owner; **potential getopts initialization overlap in this same file**, see below. |
| `src/commands/network/types.ts` | required-likely / modify | `HttpRequest` at 5 currently lacks the prototype's optional `registerCleanup` hook. Add only the reviewed historical shape if accepted; existing signal/transport/authorization interfaces remain. | Network and public-contract owners. |
| `src/commands/network/transport.ts` | required-likely / modify | Request creation at 29 and disposal/close handling at 43–61. Historical delta registers idempotent request cleanup before acquisition and awaits the owned request close. Preserve TLS options, header validation, signal forwarding and byte streaming. | Network source owner plus lifecycle review. |
| `src/commands/network/curl.ts` | required-likely / modify | `transfer` at 105: output-operation enrollment, acquisition/release, stdout versus VFS ownership, EPIPE/publication handling, and S1's next-only borrowed stdin adapter. Preserve per-hop authorization at 164, credential scope, retry/replay quotas, cancellation, finalizers and VFS effects. No prebuffer/deferred-enrollment V2 transplant. | Network source owner; coordinate contract/transport changes. |
| `src/commands/streams.ts` | required-likely / modify | `cat` at 191 only, plus import: the V1 file-operand-only operation and cleanup/EPIPE handling are absent. The historical tail retention hunk is a different section and already live; it must not be reapplied or reverted. | Stream-command source owner. |

Six existing feature paths are byte-identical to B0: curl, transport, network
types, contracts index, contracts io, and shell/shell. That proves those old
feature changes are absent, **not** that a blind patch is approved. Current
streams equals B0 plus its retention section only. Runtime contains later
env/shebang changes and must be merged section-by-section. The new output helper
is absent, and none of `ownedOutput`, `createOutputOperation`, or `accountedWrite`
occurs in the frozen current TypeScript source inventory.

## Conditional documentation and no-change paths

| Exact path | Status | Reason / boundary |
| --- | --- | --- |
| `src/contracts/command.md` | conditional | Contracts owner may document the accepted operation helper's relationship to invocation cleanup, admission and local output ownership here. Existing cleanup requirements remain authoritative; this does not authorize weakening them or invent a new global first-read lifecycle. No new documentation filename is presumed. |
| `src/commands/network/README.md` | conditional | Network/docs owner should update accepted transport cleanup and streaming/output-ownership behavior if promoted. Preserve the already-live zero-cap explanation. |
| `src/commands/network/shared.ts` | nochange-already-live | Frozen bytes equal `bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29`: only maxRedirects/maxRetries have minimum zero, other limits retain their rules. ZERO-only TEMP overlay is not a new production write. |
| `src/commands/internal.ts` | nochange-already-live; exclude retention overlay | Byte-identical to final S1. Owned copies in collect/lines are unrelated retention work. |
| `src/commands/network/body.ts` | nochange-already-live; exclude retention overlay | Byte-identical to final S1. Replay-cache ownership is already fixed; S1's stdin adapter belongs in curl, not a prebuffer replacement here. |
| `src/commands/structured/jq.ts` | nochange-already-live; exclude retention overlay | Byte-identical to final S1. Program-buffer retention is unrelated to output operations. |
| `src/contracts/command.ts` | nochange-already-live | The optional `CommandContext.registerCleanup` and existing invocation contract are already present; no new field is evidenced by this feature chain. |
| `src/shell/cleanup.ts` | nochange-already-live | Existing `InvocationScope` admission sealing, child draining, idempotent settlement and failure tracking are already present, byte-identical to S1. Review compatibility; no unconditional shared-lifecycle rewrite is justified. Any newly demonstrated need requires fresh ROOT scope approval. |
| `src/shell/types.ts` | nochange-already-live | No owned-output delta here; `State` actually lives in runtime.ts. Do not allocate this file merely because getopts involves state. |
| `src/commands/network/index.ts` | nochange-already-live | Existing type star export and transport exports already provide routing for the contemplated HttpRequest change. |
| `src/commands/network/args.ts` | nochange-already-live | No owned-output argument/API delta; retain current parsing and host caps. |
| `src/commands/network/output.ts` | nochange-already-live | No historical feature delta. Existing streaming/VFS output helpers are used through the curl context/signal adaptation. |
| `src/index.ts` | nochange-already-live | Existing contracts and network star exports suffice as source routing; preserve newer command/backend exports. This is not built or packed export acceptance. ROOT integration owner controls any later change. |
| `package.json` | nochange-already-live | Existing root, `./contracts`, `./contracts/*`, and network exports plus dist packaging already describe the routing. No package rename, dependency/config change or speculative new subpath is proposed. ROOT integration owner still owns it. |

These statuses are section-specific. In particular, streams.ts is a **likely
feature write** while its retention section is **no-change**. A same-file
retention hunk does not become an output-feature requirement.

## Excluded unrelated capture and current advances

| Exact path | Status | Reason |
| --- | --- | --- |
| `src/commands/tree/arguments.ts` | excluded-unrelated | One of three dirty captures already in B0; current committed bytes also differ from that capture. Neither captured content nor an old clean Git version is an output rebase input. |
| `src/commands/tree/io.ts` | excluded-unrelated | Dirty-captured B0 content remains through S1 and equals current; not a feature delta or new write. |
| `src/commands/tree/tree.ts` | excluded-unrelated | Same dirty-capture boundary; not a feature delta or new write. |
| `src/commands/execution.ts` | excluded-unrelated | Preserve current env replacement/forwarding behavior; the feature does not require editing this consumer. |
| `src/commands/env-split.ts` | excluded-unrelated | Current-only env split-string support, not in historical S1. Do not delete or substitute it. |
| `src/shell/input.ts` | excluded-unrelated | Preserve current cursor/read/cancellation ownership; S1's borrowed stdin adapter is local to curl. |
| `src/commands/search/rg.ts` | excluded-unrelated | Preserve current direct-stdin cancellation handling and search behavior; no evidence for an owned-output write here. |
| `src/commands/search/index.ts` | excluded-unrelated | No feature delta; no registry or command-family integration change is proposed. |
| `src/plugins/index.ts` | excluded-unrelated | Preserve current aggregate composition/exports. Do not auto-enable curl or SafeJS. |

All other paths in `inspection.currentVersusFinalS1` are explicit preservation
inputs, not a request to restore historical source. This includes newer command
families, regex workers, filesystem allocation/provider contracts and wrappers.
Historical fixtures, compiled outputs, root configs, Q comparison archives,
rejected V2/prebuffer code, current TEMP audit outputs, and private SafeJS bytes
are not production overlays. Historical native/fixture defects remain intact.

## Getopts coordination boundary

Poincare's READONLY getopts planning is acknowledged from ROOT's assignment;
this worker did not inspect or poll Poincare's unsealed work or infer its final
write list. The precise **existing-source** overlap is:

- `src/shell/runtime.ts`: owned-output targets at 85/231/335/378 share a file with
  builtin-name dispatch at 30, `State` at 136, `cloneState` at 240, function/local
  positional handling, `invokeScoped` at 1464, and `builtin` at 1500. State and
  dispatch are not a separate `state.ts` module. This is a likely file-level
  collision even if eventual hunks are distinct.
- `src/shell/shell.ts`: owned-output sink adapter at 115 shares a file with
  initial `State` construction at 141. If getopts initialization changes that
  constructor, ownership overlaps here too. This is conditional, not a claim
  that Poincare has already requested or edited this file.

Owned-output itself does not request new State fields, getopts dispatch,
shell/types changes, or a runtime refactor. ROOT must settle these file boundaries
before **either implementation**; this document grants no source ownership.

## Authenticated source-chain evidence

`inspect-public-inputs.py.data` is an inert, opt-in stdlib inspection driver, not
a canonical test. `MANIFEST.json` stores its complete JSON result and proposal
classification. It reads pinned public Git objects; tar members and patch stages
are compared in memory, never extracted to a candidate or imported/executed.

1. B0 archive SHA-256:
   `0066bc48069f116b549ea895e4972c02ed6958be641fd23ea3b6db26cc181f05`.
   Its 227 semantic files match independent B0 receipts. The exact archive's 270
   AppleDouble sidecars are separately counted/hash-checked, not compiler inputs.
   The three dirty source captures were independently compared to original
   `c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79` blobs: **B0 is not a clean Git base**.
2. Whole V1 source-r1 patch SHA-256:
   `d73bb2637d54b97f62fd6e1baa57100cf0018a763679c31386349e30a19cc4e2`.
   It changes **nine production paths**, the nine likely paths listed above.
3. Four-path retention patch SHA-256:
   `063751093b7cf887d35b33498b65e1ef49a2f35f9dfb28e368ab6e409fda05b5`.
   Its paths are internal.ts, network/body.ts, streams.ts, structured/jq.ts.
4. One S1 source-S1-r0 patch SHA-256:
   `80c523e21610d90c67c8ab0084532ab465f645a0d57442dcd952795de01f2f3f`.
   r1 is byte-identical and **not applied again**. It changes only network/curl.ts
   and contracts/output.ts. Thus V1-to-final-S1 is six paths, but four are retention
   sections and only two are final-S1 feature deltas. Across the full B0-to-S1
   source chain there are twelve distinct paths, nine feature-bearing, not six.
5. Alternative complete Q candidate archive SHA-256:
   `a3b9aa6fcb4596e8281de2c30943b98baa01449941c8368401d1172bce95d420`.
   It is **not another overlay**. Every Q archive file matches SOURCE-PROFILE;
   all 213 source identities equal the in-memory ordered source route.
   Source manifest: `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
   Full 940-file manifest: `a2632992e84344c1a6a92fcee181a1e6d535d6cb87ef1a9a7841e48af9c02e28`.

Each source stage matches the independent `07a7dae5` receipt's source inventory.
Original-commit/frozen-commit bytes were checked for all selected artifacts and
receipts, including the `db139ae9` report qualification. Actual independent paths
are `receipt-review/REPORT.md`, **`receipt-review/STAGES.md`**,
`receipt-review/attempts/r2/proof.json`, and `receipt-review/verification.json`.
There is no asserted `attempts/r2/STAGES.md`. The two pinned e57b5aa1 ordering
authentication receipts bind the exact selected candidate prefix to all 940
Q path/SHA-256 pairs before and after; those receipts omit byte counts. This is
receipt/source authentication, not a fresh ordering or SafeJS execution.

The author retrieval TXT was used as a locator only. Authentication instead uses
the supplied hashes, original Git blobs, archive bytes, strict patch contexts,
Q profile, and independent receipts. Historical fixture/compiled inventories
were read only for Q identity: no fixtures were installed and no rebuild occurred.

## API and promotion blockers

The actual hypothetical S1 surface is `ByteSink.ownedOutput?` with
`consumerClosed: AbortSignal` and `write(Uint8Array): Promise<void>`;
`createOutputOperation` takes the context's signal/registerCleanup and a ByteSink
destination, and returns `signal`, `output`, `registerCleanup`,
`acquire(start, release)`, `child(destination)`, and `close()`.
`HttpRequest.registerCleanup?` is also hypothetical production promotion.
**There is no `accountedWrite` field** and no V2 input/prebuffer API in this chain.

Separate blockers, not newly executed verification:

1. **Current TEMP actual-SafeJS audit is pending in ROOT's supplied handoff.** ROOT's
   supplied status is the only basis here; this worker did not read the ongoing
   audit or infer the result of guard-only revision
   `71abbafc8a9adadf98ed8921b4cc549ae90399ff`. Author freeze a61e63bc is S1 plus only
   the shared.ts zero allowance (source manifest
   `2dc95c3abd7656de60d10a2f339a80d14d31ecc2b6d1a8f037769826cc8479f1`).
   Reconstruction/25-fixture profile review 50897e9e and admission 88367f70 do not
   establish guest execution. Preflight 8e950 refused author-folder 88/additional
   output; 31f567/06426 historical-private-status refusals remain preserved, with
   fresh before/after source matching as supplied. Do not infer audit closure.
2. **Prospective source/contract rebase review and ownership are outstanding.**
   Review current cleanup/admission and budget forwarding against the proposed
   helper. In particular, historical `acquire` registers a disposer before start,
   but a disposer can return before a still-pending acquisition yields a resource;
   `close` drains callbacks, and the pending continuation can dispose later.
   Reconcile which work is admitted cooperative resource work versus opaque host
   work under the current contract. This is a source-review question, not a
   newly observed runtime failure or authority to wait on every opaque promise.
   Preserve signal reasons, late rejection observation and independent ownership.
3. **Later current-candidate tests, declarations, built/packed public consumers,
   and actual-SafeJS acceptance are not supplied by historical S1 results.**
   After an approved source rebase, owners must verify the actual committed
   source, supported contract/export surfaces, literal env/shebang invocation,
   shared output accounting, cooperative cleanup, rg/input cancellation, curl
   byte streaming/authorization/VFS effects and supported output-operation cases.
   Test write ownership is a separate ROOT assignment; no test or private-package
   implementation is proposed or performed here. No dependency additions.

Prior pure-S1 evidence remains exactly qualified as supplied: revised surface
8/8 = six supported rows plus 07 dialect and 08 await-rejection; lifecycle 11/11
independently 9f44add1. Preserve original surface 7/8 and lifecycle eight passes,
one failure, one invalid, one blocked. The original five custom pre-first-read
cases remain baseline 0/5, prototype 1/5, API-opt-in 5/5, a separate cohort rather
than an all-closed claim or an invented global first-read requirement.

## Validation and handoff limits

Completed only read-only hash/blob/strict in-memory source-diff assertions and
evidence integrity checks. **Tests/build/typecheck/install/host network: not run.**
No source behavior or superiority conclusion follows from this inventory.
The inspection driver's first local attempt assumed ordering receipts contained
byte counts; it stopped at that schema assertion, was corrected to their actual
path/hash shape, and then completed. No product or fixture was changed.

The evidence commit binds only this new directory. The regular-TMP handoff
`/tmp/safe-bash-owned-output-production-rebase-proposal.txt` records the exact
evidence commit, frozen source hash/tree, likely paths, blockers and locations.
Foreign staging/untracked artifacts are not owned inputs. This is not a claim of
an append-proof live-tree audit or certification of later concurrent commits.
