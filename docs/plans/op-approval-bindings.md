# Resolved operation approval bindings

## Status and boundary

Bounded architecture approved for implementation; this document does not itself establish completion. Preserve the original invariant for resolved approvals without adding distributed host transactions. The earlier bulk/reference/help checkpoint was frozen and packed successfully; that artifact predates this implementation. Neither passing tests nor a successful pack establishes this security property.

Scope: the public policy-enforcing CLI/SDK composition, object backend, nested handlers, and explicit host capabilities. Preserve account/session security, bulk atomicity, field-reference behavior, and native command syntax. No ambient credential/configuration discovery, new native flags, README changes, commits, pushes, or publication are authorized here.

## Required promise and concrete evidence

Exact requirement from `docs/plans/op-compatibility.md`, “Required standalone architecture and host approvals,” item 7:

> Approval input binds the canonical operation, selected account/backend, resolved target identities, mutation intent, output destination, and child executable/argv/environment names. Redact secret values, tokens, passwords, and secret-bearing assignments from the approval description and audit log. Target changes invalidate approval. Define cancellation, timeout, denial, batch requests, and retries explicitly.

Confirmed in-memory public `createOp` reproduction, using synthetic values only:

1. Seed vault `vault` and item A (`first-id`, title `Approved Name`) plus item B (`second-id`, title `Other Name`). Give each a distinct synthetic password field.
2. Execute `item get "Approved Name" --format json`; policy returns `ask`. Hold the approval callback pending and retain its request.
3. A second trusted backend actor renames A to `Renamed` and B to `Approved Name`.
4. Approve the original request. The command returns B, although the approved request remains deeply equal to the captured request.
5. Control: requesting `first-id` returns A despite title reassignment. This control does not establish content-version binding.

Current source supports the mechanism: `cli.ts` freezes the literal request before `authorize`/`approve`, then dispatches to a handler or `backend.execute`. Backend selector resolution occurs afterward. `index.ts` constructs nested handlers with the raw backend; `secrets.ts` and `environment-commands.ts` issue additional asynchronous backend requests. Freezing the outer request and environment is valuable but does not pin those resolutions.

This is a project-contract violation, not evidence about proprietary native approval behavior. The repro requires concurrent access by another actor; that actor's direct backend access is not itself the alleged authorization bypass.

## Approved policy dispatch

- `authorize: deny`: stop before backend access or host effects.
- `authorize: allow`: preserve the existing direct execution path. Do not invoke approval or metadata discovery implicitly, and do not describe this path as resolved approval. Preserve existing behavior when no authorizer is configured.
- `authorize: ask`, with default `approvalMode: "resolved"`: require explicit resolution permission, backend binding support, and resolved approval. Missing capabilities or callbacks fail closed.
- `authorize: ask`, with explicit `approvalMode: "literal"`: retain the existing `approve` callback behavior. It authorizes immutable selectors with late lookup and does not provide the resolved-identity guarantee. Never fall back to this mode implicitly.
- Mode selection is trusted embedding configuration, not agent-controlled argv, environment, input, or a provider response. `allow` and `ask` are not metadata-resolution grants.

## Scope correction

Required work binds backend target identities, account/backend selection, backend generations, mutation intent, and the supplied output/child invocation description across nested calls. Existing host capabilities continue to own filesystem, process, restore, and network effects.

OS inode pinning, executable-content identity, distributed reservations, policy epochs, a new deadline service, and mandatory per-object revision infrastructure were stronger additions in the first proposal, not explicit original requirements. They are excluded from this implementation. Cancellation/timeouts use the existing signal; a stale binding fails and a retry starts a new approval attempt. No automatic retry or rollback of external effects is promised.

## Proposed capability boundary

Names below describe a proposed API, not existing exports or a finalized signature.

| Component | Responsibility |
| --- | --- |
| Trusted operation coordinator | Own request/context snapshots, policy stages, opaque bindings, cancellation, lifecycle, and release of output/effects. |
| `authorizeResolution` capability | Permit bounded metadata discovery for a particular operation, backend/account scope, selector set, and acquisition sources. May use explicit host preauthorization or a separate prompt. |
| Backend binding capability | Prepare metadata-only target bindings; validate versions and authorization; execute bound reads/transactions without re-resolving caller selectors. |
| Bound operation broker | Give handlers only authorized nested reads/mutations and effect requests; reject unplanned targets. Do not expose raw backend execution to resolved-mode handlers. |
| Existing host capabilities | Execute the approved frozen destination and invocation description; retain owned input bytes and existing cancellation/lifecycle behavior. No new distributed admission protocol. |
| Final operation policy | Approve a redacted resolved manifest; the coordinator privately pairs it with the backend-issued handle. No authority is passed to UI/audit callbacks. |

An adapter implements optional `prepareBinding(requests, context)` and `validateBinding(handle, context)` in its existing provider module. Preparation returns `{ handle, targets }`; generation state remains private. Existing `execute` receives the handle through optional `OpBackendContext.binding`, checks request coverage and live generation/authentication, and executes captured identities. Shared orchestration selects capabilities structurally, without backend-name branches or additional registration files. Execute-only adapters remain usable on the direct and explicit literal paths, but fail resolved approval.

CLI options add `approvalMode: "resolved" | "literal"` (default resolved), `authorizeResolution(discovery, context)` and `approveResolved(manifest, context)`, both decision callbacks returning boolean or a promise of boolean. Discovery identifies the bounded request and input-acquisition scope. The resolved manifest contains sanitized immutable operation/effect metadata and resolved targets, never the opaque handle. The coordinator retains the private manifest/handle pair and exact unredacted request. Peirce owns shared types, Newton the handler contract, and Planck CLI orchestration.

### Approved public manifest allowlist

`OpResolvedApproval` contains only:

```ts
interface OpResolvedApproval {
  readonly operation: { readonly resource: string; readonly action: string };
  readonly backendId: string;
  readonly accountId: string | null;
  readonly targets: readonly OpBindingTarget[];
  readonly optionNames: readonly string[];
  readonly mutation: {
    readonly requested: boolean;
    readonly propertyNames: readonly string[];
    readonly assignmentNames: readonly string[];
    readonly batchSize?: number;
  };
  readonly output: {
    readonly kind: "none" | "stdout" | "file";
    readonly destination?: string;
  };
  readonly child?: {
    readonly executable: string;
    readonly argv: readonly string[];
    readonly environmentNames: readonly string[];
  };
}
```

Build this projection explicitly and deep-freeze it; never spread raw requests, inputs, flags, environment values or provider objects into it. `backendId` identifies the injected backend instance, not a credential-bearing URL. Account and target IDs come from preparation, not unverified selectors. Target revisions may be opaque generation identifiers, never secret-content hashes. Mutation metadata exposes names only, not assigned values.

Every child argument becomes `"[redacted]"`, preserving order and count. This deliberately hides both positional secrets and assignments without pretending to classify arbitrary programs' arguments. The tradeoff is that approval cannot inspect argument contents; trusted policy may deny if that visibility is necessary. Executable and output destination describe the explicitly supplied host operation, with no inode/content guarantee. Full argv, input, flags, environment values and request payload remain privately pinned and are used for execution, never reconstructed from redacted metadata.

There is no public `binding`, `handle`, raw `request`, or hidden symbol carrying authority. Neither approval callback context nor UI/audit serialization receives a backend handle. A serialized manifest grants no execution capability.

The backend and host are trusted computing-base components: a malicious adapter can lie about revisions or leak data and is not sandboxed by this interface. Agent input, serialized operation objects, prompt text, and arbitrary identity strings are untrusted.

### Opaque binding ownership

- Coordinator/backend mint non-serializable handles backed by private runtime identity, such as a closure-owned registry or `WeakMap`. TypeScript brands alone do not prevent forgery.
- Bind handles to the issuing backend instance, account, authentication context, prepared requests, data generation, and operation signal. Cross-backend/account/session use fails.
- Never accept handles from CLI input, JSON, environment, or persisted provider objects. Backend-issued handles remain private to the coordinator/backend execution path and are omitted from public approval manifests and callback contexts. Type declarations are not the enforcement boundary.
- Scope a handle to one operation, including its planned nested calls. Abort, denial, failed validation and completion end its usable operation lifetime; owners must implement cleanup without a new lease/deadline service.
- Do not display secret values or secret-bearing arguments/assignments. Preserve their exact bytes privately. Even hashes of low-entropy secrets must not appear in approval/audit data. Safe display labels cannot substitute for private identity comparison.

## Authorization protocol

1. **Local intent gate.** Parse and canonicalize without backend calls. Snapshot supplied context, authentication integration, plugin scope and arguments. Apply the approved dispatch above: deny stops, allow stays direct, explicit literal ask uses the legacy approval callback. The remaining steps apply only to resolved ask. Source acquisition for resolution must be explicitly permitted; do not introduce ambient input/config discovery.
2. **Resolution permission.** Request a bounded discovery grant. Denial here still means no backend access. Protected metadata is not “free” because it lacks field values. A grant authorizes only declared metadata/source acquisition, not execution, secret reads, credential refresh, or activity writes.
3. **Prepare.** Backend resolves selectors under that grant into account/object/field/section identities with private generation checks. Read-only preparation must not use ordinary secret reads then redact the result. Host acquires explicitly permitted sources into private owned buffers.
4. **Final approval.** Submit the immutable redacted manifest, including discovery scope and exact effects, to operation policy. Denial may follow already-authorized metadata acquisition but causes no secret fetch or execution effect. State that distinction explicitly in audit records.
5. **Bound execution.** Validate generation and live authorization; run through a binding-aware backend wrapper against the prepared identities, not fresh name lookup. Buffer nested secret results privately. Validate again after asynchronous reads and before handing output or effects to existing host capabilities.
6. **Commit/release.** Check the binding at the backend's existing local commit boundary before publishing mutation state or authentication changes. A changed target fails with a safe error; retry requires new preparation/approval, never transparent retargeting. Local commit checks do not create an atomic filesystem/process transaction.

Metadata acquisition can require a prompt of its own. `--force`, no-input mode, reveal/raw output, and native confirmations never manufacture either discovery or execution permission. A host can preauthorize both stages explicitly, without requiring two interactive prompts.

## Binding semantics and concurrency

Use immutable object identity plus a generation/version token, not just an ID or title. Deletion/recreation with the same ID is a different generation. A rename, move, selected-account change, relevant ACL change, or content update invalidates the pending binding; do not quietly continue by ID after a changed target. The manifest's account selection is pinned, not reread from an app preference after approval.

Capture source/destination vaults, field/section ownership and selected objects. New-object operations bind the existing destination and exact creation intent, not an invented identity for an object that does not yet exist. List/batch membership must not silently be looked up again after approval; coarse generation validation may protect it without a separate phantom/predicate-lock subsystem.

Initial object-backend policy may use coarse data-generation invalidation. This can reject an operation after an unrelated concurrent data change: an accepted conservative extra abort, not a reason to introduce per-object tracking now. Caller-owned input remains detached. Preserve existing live session revocation/suspension checks and local transaction behavior. Check generation before publishing local writes; an operation's own staged writes must not be mistaken for a concurrent retarget.

A remote adapter must implement genuine identity binding or report unsupported. A final name lookup disguised as validation is insufficient. Backend checks across nested awaits prevent redirected reads and mixed-generation output. Existing host callbacks own effects after handoff; there is no cross-backend/host reservation or atomicity guarantee. Cancellation does not undo already performed external effects or constrain a noncooperative host beyond its existing contract.

## Nested operation coverage

| Operation | Required private binding and disclosure boundary |
| --- | --- |
| Item get, batch get, field projection | Bind every selected item/version and field/section before rendering. Full JSON references are derived from current bound IDs; projections do not independently re-resolve. Batch membership/order and duplicate semantics are fixed. |
| Bulk/admin mutation | Bind the entire validated batch, account, destination, membership/ACL dependencies, and mutation payload. Malformed late input or one stale target means no local publish, activity update, or partial output. External admin hooks need explicit bound capabilities. |
| `read` | Bind vault/item/section/field, reference query semantics, output format and destination. No secret value lookup during metadata preparation. |
| `inject` | Explicitly authorize template/file acquisition; copy bytes privately. Parse a dependency plan separately from resolving values. Bind every reference and output sink; nested asynchronous reads use the broker. Source replacement cannot alter the approved template. |
| `run` | Bind executable/argv, cwd, owned input environment, env-file bytes, environment-object IDs/versions, all reference dependencies, masking policy, and final environment names. Environment objects contain secrets: their values cannot be fetched just to prepare a prompt. No spawn until the full graph is authorized and validated. |
| Snapshot create | Bind explicit variable selection, owned values privately, variable names, absent-key semantics, snapshot name and destination uniqueness. Never reread mutable caller environment after approval. |
| Snapshot get/list/delete | Bind snapshot identities and generation. Provide genuine metadata-only resolution; today's metadata renderer validating a full snapshot is not a discovery capability. Deletion binds the exact snapshot, not its late-resolved name. |
| Snapshot restore | Bind snapshot/version, base environment, resulting set/unset names, and target host session, shell-output sink, or child process. Complete restoration may remove keys; approve that intent as well as additions. Validate before callback/spawn/output admission. |

`run` can derive later reference targets from environment values. A complete graph cannot always be discovered without a protected read. Two supported strategies, never an implicit wildcard:

1. A backend supplies an explicitly authorized non-secret dependency manifest with consistency tokens sufficient to bind the whole graph before secret execution.
2. The coordinator obtains approval for the initial protected read, retains its result privately, then requests separately authorized resolution and approval for newly discovered dependencies. No final output, mutation, restore, or spawn occurs until all stages are approved and the combined graph remains valid. Discovery of names derived from secrets is itself sensitive: do not print them without disclosure permission; otherwise fail unsupported.

Do not build a general graph engine or speculative recursive expansion framework. Later asynchronous calls must be covered by the prepared requests. If current expansion semantics reveal a new target, require explicit additional permission and preparation or fail unsupported. Do not change official expansion semantics merely to simplify approval planning.

Pure `captureEnvironment`/`restoreEnvironment` value transformations remain ordinary trusted SDK utilities; they neither fetch backend data nor change a host environment by themselves. Command-level persistence, disclosure, restoration callbacks, and spawning take the policy path. This proposal does not expand snapshots beyond the implemented variable scope.

## Composition and compatibility

Wire handler factories to a binding-aware backend wrapper in resolved mode rather than permitting unbounded raw backend execution. Custom handlers must expose their backend requests and use that wrapper, or be explicitly unsupported in resolved mode. Direct allow remains direct by the approved policy decision. Apply the same coordinator to public CLI and policy-enforcing SDK entrypoints.

Raw backend APIs remain trusted low-level capabilities; exposing them directly to an agent defeats the boundary and must not be presented as equivalent to `createOp` authorization. No provider-specific branch or mandatory second provider file is needed.

Keep the intentionally catalog-only completion callback exception: no backend/private queries or runtime binding discovery. Keep native flags and stable/beta gating unchanged. Resolved approval is an embedding security contract, not a claim of authenticated native prompt/output parity. Legacy tests intentionally exercising old `approve` behavior must select literal mode explicitly; new resolved tests must supply an explicit resolution grant and resolved approval.

## TDD acceptance evidence required

- Reproduce the exact name-reassignment race through public `createOp`; resolved execution must reject without disclosing B. Preserve a separately explicit literal-mode control demonstrating the different contract.
- Cover ID-stable generation changes, rename, move, delete/recreate ABA, field/section remapping and selected account changes. Assert coarse invalidation behavior without requiring per-object concurrency optimizations.
- Hold the first nested read pending, change a second target, then resume `inject`/`run`: no redirected output or spawn. Exercise unsupported or separately approved secret-derived dependencies.
- Replace env-file/template bytes after acquisition; mutate caller buffers/env; change snapshot names and contents during approval. Assert owned bytes, explicit unset intent, and no redirected restore target.
- Assert initial denial makes zero backend/host acquisition calls; resolution denial makes zero backend calls; final denial after permitted metadata performs zero secret reads, activity writes, mutations, output, or spawn.
- Try forged, serialized, cancelled and cross-backend/account/session handles and unplanned nested requests. Missing callbacks/capabilities fail closed without invoking legacy approval. Direct allow and explicit literal mode retain their separate behavior.
- Preserve authentication rejection after revoke/reissue/signout/suspension during pending work; do not turn this checkpoint into a new authentication subsystem.
- Verify late-malformed batch input and late-generation conflict leave backend/caller state unchanged. Use controlled promise barriers, not timing guesses; do not require distributed host transactions.
- Audit approval descriptions and errors for synthetic secret arguments, env values, tokens, hidden identity assertions, and value hashes. Output masking does not substitute for authorization.
- Use in-memory fixtures, memfs and mock process events; no disk or live credentials. Pending helpers race callback entry against early command completion so parse failures cannot hang siblings.

## Delivery and remaining evidence

Current residual: immutable literal approval does not fulfill the required resolved-target promise, including nested operations. This document proposes the fix; it does not close that gap. No new failure claims about unrelated current work are made here.

The current checkpoint coordinates shared types/CLI, backend binding and nested handler owners. Independent regression evidence in `out/op-approval-bindings-red.log` records one passing unchanged control and one failing retarget test: exit 0, `second-id`, 270 output bytes instead of rejection without output. `packages/op/src/approval-bindings.test.ts` is the acceptance anchor and will adopt the approved explicit callbacks. Object-backend proofs do not establish remote adapter behavior or native authenticated prompt fidelity.

After the declared freeze, 85 backend/reference tests passed and the maintained `npm pack` prepack build completed. An ignored consumer installed the archive with `--ignore-scripts`; bin version/help, root and Node SDK imports/operation, consumer typecheck, catalog completion, cross-account bulk copying, malformed-late atomicity, and moved field-reference roundtrips passed. Evidence is in `out/op-frozen-independent-tests.log`, `out/op-frozen-prepack.log`, `out/op-frozen-pack.json`, `out/op-frozen-consumer-install.log`, `out/op-frozen-bin.log`, `out/op-frozen-consumer-types.log`, and `out/op-frozen-consumer-smoke.log`.

Artifact: `@poe-platform/op@0.0.1`, SHA-256 `0c5d6926778f4b3ccbed9b599662290d93ae5c51678b0b2b9f79d31ba5f7dbe7`. `out/op-frozen-artifact-proof.log` records integrity, executable bin, and installed dist equality with the frozen build. The manifest still lacks README: that required gate is not waived. Both README and the unresolved approval-binding invariant block release. Report source tests, packed verification, local commits, verified remote delivery, and release separately. No commit, push, publication, or README permission is implied by approval of this architecture.
