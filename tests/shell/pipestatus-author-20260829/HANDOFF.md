# PIPESTATUS implementation: qualification held after G18

## Implemented source

`src/shell/pipestatus.ts` classifies visible indexed bindings, own scalar keys,
readonly absence, local tombstones, exported absence, and ordinary absence.
Eligible completion vectors use the existing shared invocation-root array ledger,
pre-admitted staging, checked tickets, and one synchronous visible publication.
Internal replacement of indexed PIPESTATUS intentionally bypasses ordinary user
readonly-write rejection. Scalar/export safety remains unchanged. No public API,
parser, BindingStore, ArrayOwner, or Shell lifecycle file was modified.

`runtime.ts` publishes simple/subshell/arithmetic/conditional completions after
their cleanup, preserves raw pipeline stage values before pipefail/negation,
uses the special conditional/arithmetic same-node negated value, and avoids
brace/definition/loop/if/case wrapper publication. Explicit numeric exit/return/
break/continue and diagnosed fatal completions carry private completion provenance;
arbitrary escaping errors are not reclassified as numeric completion. Existing
registered cleanup failures suppress new publication. Local scalar PIPESTATUS
shadows retain the outer typed binding for existing scope restoration.

No command body has been executed in this grant. These completion-route claims
are SOURCE implementation descriptions, not public behavior acceptance.

## Frozen inputs and results

307 shipping inputs = accepted da4e1cc187022255521879b00db2ac77674f79d9 (305),
the pinned ffac894 arithmetic runtime override/new private module, and the
PIPESTATUS runtime override/new private helper. The parser is the accepted ERE
composition's parser, not mutable HEAD/B35. Unchanged ERE and both arithmetic
callsite regions are byte-authenticated by prepare.mjs. Package/root exports and
public limits are inherited unchanged. This does not accept the pending ERE
transport/runtime or any later coherent Node composition.

Original source seal: SEAL.json. One strict TypeScript build passed, including
the positive private types and two exact expected-negative type positions.
Pure checks: **23/24**, zero Shell/native/Worker execution. G18 is a real missing
whole-state epoch guard in the new helper, corrected in SOURCE only; see
G18-SOURCE-CORRECTION.md. The old assertion, failure and original compiled bytes
are preserved. There was no second build or hidden rerun. The new helper revision
requires a fresh build and unchanged G18 replay before independent acceptance.

PACKAGE.json binds the original build's complete manual artifact projection,
including root package metadata, README and emitted shipping files, excluding
the validation-only type fixture. It is not npm-produced/installed proof and
does not contain the uncompiled G18 source correction. SOURCE-SUCCESSOR.json
separately binds that correction. No archive is inflated in this phase.

## Remaining actual functions to verify

- `publishPipelineStatus`: corrected epoch conflict refusal, recompile/replay;
  private displaced-binding cleanup after synchronous publication remains an
  existing array-owner behavior, not a rollback guarantee for arbitrary faults.
- `Runtime.command` / `pipeline`: actual raw vectors, scopes, substitutions,
  same-node negation, errored redirections, numeric/fatal/errexit ordering.
- `Runtime.builtin` local branch: scalar empty/seed versus local indexed restore,
  readonly metadata and the SOURCE-only local-tombstone target policy.
- Public registered cleanup/caller/sink/context.invoke priority: the untouched
  provenance machinery is source-bound, but no new host protocol was executed.
- Raw pipeline task failure cleanup retains existing implementation; this patch
  does not claim universal rollback or hard preemption of opaque handlers.

runtime-cases.json provides 18 fixed visible-output fixtures for each future
layout, all UNRUN. legacy-32.data.json retains all old matrix records unchanged;
F01–F10 are gated on separate function-keyword composition. Typed P19–P24 native
declaration observations remain accepted finite local-Bash data, not this product's
unsupported declare implementation. Five named host protocols still need concrete
public executors before an actual full three-layout grant; no READY/runtime claim.

## Resource and historical qualifications

All pure fixture scopes were awaited. The compiler and both launched helpers
returned normally; the pure coordinator's exit 1 is G18's assertion, not an
unknown-retirement/safety stop. Original instruction-contaminated capture remains
unchanged and excluded. Only its opaque hash/size is recorded in SEAL.json. Its
affected extent is unknown; the old final five starts are shell + four sed, with
an incomplete historical log. No instruction text was copied into this evidence.

Fresh known-role log and publication snapshots are invocation-local evidence,
not a universal descendant census. Foreign staging and previous scratch captures
are untouched. No additional destructive cleanup is authorized or performed.
