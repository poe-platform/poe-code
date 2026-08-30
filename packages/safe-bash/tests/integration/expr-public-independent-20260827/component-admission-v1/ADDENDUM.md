# Expr public component admission v1 — August 28, 2026

Status: **PRE-EXECUTION ADDENDUM CHECKPOINT; root review required.** This is a
separately versioned component recipe, not a change to the August 27 freeze,
accepted-DU/HTML admission, or a completed independent review. Stop after sealing
this addendum and its read-only authentication receipt. No candidate code is
imported, installed, built, executed, or given a worker by this checkpoint.

## Immutable authority and ownership

- Original nine-file freeze: `f8b982f09e51b9a0a073b0b7bb393cb54796dd62`.
- Integration source: `a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e`.
- Candidate: `44f00bf84278e3361b52106478d59c707ab7b2bc`, tree
  `5905cf8d43233c68ea2bd499275ada2641223d9a`.
- Author evidence: `8d07bd6e7549aaa9a1096c3e9278b231692bc699`.
- Root-selected DU75: `0895de2dc63014989f23912c3d48f7c4d0d35a47`;
  **selection only, not accepted status**.
- Exact existing fullpack SHA-256:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
- Accepted engine byte reference: `c3e40f8bd721da5e496f3b3abfd51aee45db5a84`;
  module acceptance `c14363bd191042d42defc8498c4d084cf9411375`, handoff
  `b158d1e5732642e1386110db70fcc0cc2c4c6e20`. Byte comparison is not an engine audit.

Only new paths beneath this directory are owned. The old nine files, old
validator, product, engine, TEMP, root/package/config/AGENTS files, private repo,
other workers' files/index entries, branches, and unrelated refs are untouched.
TAP remains Dirac's; HTML admission remains Raman's; actual HTML34 remains HELD.
No duplicate materializer, fullpack build, broad audit, or full gate is authorized.

## Why frozen admission cannot run unchanged

1. Frozen `consumer.mjs:53` asserts `binding.du75AcceptedBeforeRun === true`.
   Frozen README and PROTOCOL require an accepted DU75 binding before execution.
   Root supplied a selected base, explicitly not accepted-DU/HTML proof. Passing
   `true`, fabricating a getter, bypassing assertions, or counting 75/76 names
   would falsely discharge that prerequisite. The original consumer remains HELD.
2. Frozen P01 prescribes building/packing the whole bound candidate in isolation.
   The latest authority instead selects the existing exact fullpack and prohibits
   duplicating Raman's materializer/fullpack work. Reusing this artifact is an
   explicit recipe delta, not an independently repeated P01 build result.
3. The declared observer exists, but independent R25/R26 adapter and negative
   qualification have not run. The author R25 helper disposes before its marker;
   it cannot establish the required independent EXEC-ONLY boundary. Generated
   loader guards also need independent run-specific prebinding, not copied claims.

## Proposed component-only recipe deltas

After root reviews this sealed checkpoint, create a NEW versioned consumer copy
from the frozen Git blob. Permit exactly one admission-statement replacement:

```js
assert.equal(binding?.du75AcceptedBeforeRun, true);
```

becomes:

```js
assert.equal(binding?.componentProfile, "expr-public-component-v1");
assert.equal(binding?.du75SelectedBeforeRun, true);
assert.equal(binding?.du75AcceptedBeforeRun, false);
assert.equal(binding?.acceptedPrerequisitesStatus, "HELD");
assert.equal(binding?.baselineCommit, "0895de2dc63014989f23912c3d48f7c4d0d35a47");
```

Bind the old/new consumer hashes and an exact single-replacement proof before
any candidate execution. Keep `candidateQualifiedBeforeRun` truthful: it means
the recorded component artifact/tool/observer preflight is complete, never that
DU/HTML or the whole public package is accepted. Do not modify or run the frozen
consumer with fabricated acceptance. All case bodies, assertions, fixture bytes,
case membership, type requirements, and `fullAcceptance: false` stay unchanged.
No consumer copy or runtime adapter is implemented at this checkpoint.

P01 is split into read-only artifact authentication and HELD independent-build
reproduction. Authenticate the complete existing tarball, its exact member/hash
inventory and manifest against the immutable author handoff, and all selected
source/test/consumer Git blobs against the exact candidate. Preserve the author's
source-to-pack derivation as author evidence, not an independent rebuild. Later
P02/P03 must really install then physically move that same FULL package; neither a
dist subset nor a dependency-closure claim substitutes. Do not use mutable HEAD
or overlay live files. Reauthenticate complete trees, including added entries,
before/after execution; original-path-only checks are not append-proof.

P04–P08 retain every frozen intended boundary. Dedicated root-export removal must
load the real installed root before its missing-export assertion. Subpath removal
must produce `ERR_PACKAGE_PATH_NOT_EXPORTED` and a restored positive. Source poison
must be present and independently proven executable without denial, then denied
at the actual forbidden load boundary before its sentinel body runs. Worker poison
must first have an ordinary shipped-worker positive, then reach that exact worker
constructor/load failure, status 3/expr diagnostic, retirement, and restored positive.
Parse/startup errors unrelated to the intended boundary do not qualify controls.
Keep strict NodeNext positive, all four exact type assertions, all six individual
directive-stripped controls, combined six-diagnostic control, and broken installed
expr declaration control. Missing library/module diagnostics do not qualify.

## Declared observer binding and missing qualification

The immutable handoff is
`tests/plugins/expr-public-author/evidence-v1/REVIEW-HANDOFF.json` at the author
evidence commit. Its actual policy path is
`tests/plugins/expr-public-author/POLICY.md`, not `evidence-v1/POLICY.md`.
The read-only receipt authenticates these and the five declared observer/tool
bindings. Principal observer SHA-256:
`1fffd7e99be072e87127be1af56461334a6db529d37c8be38b5418762548e37c`.

The observer instruments Node Worker before product import, forwards real worker
traffic, and records original/actual worker URL/hash, resources, ready/request,
online/exit, termination, and ordered markers. Its `worker-guard.mjs` is GENERATED
by bound `verify-public.mjs`, not a missing committed product module. The author's
installed/moved generated guard hashes are provenance only. Future actual guard
bytes, expected absolute load paths, observer closure, supervisor, executable
hashes/versions, Node flags, npm, TypeScript/Node types, compiler options, fixtures,
and installed module/declaration/worker hashes must be frozen BEFORE the run.
Do not execute the author's 180-second/64-MiB supervisor for this cohort.

R25 must use real Shell/agentCommands, 50-ms startup, 1000-ms request, maxWorkers 1,
and the bound live silent-ready worker at the real shipped constructor boundary.
Capture EXEC settlement and assert actual worker retirement **before any dispose
call**. Only afterward dispose as final cleanup. Status 3, empty stdout, one expr
diagnostic, online qualification, withheld ready, and ordinary `1\n`/status-0
paired control remain required. An exec-plus-dispose marker cannot pass R25.

R26 binds the declared held-GENUINE-reply interception, not invented replies or a
CPU-running assertion. Two separately signalled direct invocations share the real
factory/maxWorkers 2; both are pending at cancellation. The first rejects with
the identical EACCES-shaped reason and retires without aborting the live sibling;
release only the sibling's real reply for exact `1\n`, status 0, empty stderr.
Concurrent repeated registered cleanup must share completion. Repeat through real
Shell/agentCommands and separately observe retirement before BOTH exec and dispose
settlements. Preserve actual Shell abort behavior without inventing a new shape.
Ordinary positives and meaningful interception negative controls must qualify the
adapter before affected cases. Observer helpers never manually terminate product
workers to claim product cleanup. Missing qualification remains UNBOUND, not pass.

R23 resource observations remain invocation-specific: global 48/3, direct 64/3,
and omitted-global defaults with invalid nested regex. R17/R20 no-worker and R24
registration-before-admission/idempotence requirements remain unchanged.

## Bounds, scope and disposition

- Keep frozen R01–R26: 24 consumer-backed IDs plus two lifecycle protocols, and
  two additional input variants. Keep eight package protocol IDs; no denominator
  expansion or substitution from author74/32 outcomes/35 checks/44 retirements.
- Preserve exact DU75+expr membership, not merely length 76; getopts is a builtin
  outside the registry, curl/SafeJS optional. Preserve root/subpath factories and
  types, exact aggregate Omit/limits shape, global regex/replace authority and
  direct-factory options. Static bindings are not runtime or type passes.
- Use declared Node22.22.2 and Node24.11.1 installed/moved contexts. No product
  memory/timer increase; 15 seconds per case process, 120 seconds per context,
  at most 1 MiB captured stdout/stderr per process, as frozen. Bound and reap
  failures. Intentional negative supervision kills are not natural settlement.
- Preserve every first failure and raw exit/status/output/reason. No automatic
  product repair, retry-to-pass, skipped case as pass, or full76 acceptance.
- Accepted-DU, HTML admission, actual HTML34, original acceptance-gated consumer,
  independent P01 rebuild and whole public acceptance remain HELD. R25/R26 and
  all independent candidate runtime/type/control outcomes are NOT EXECUTED.

Next root action: review this explicit selection-versus-acceptance/P01/observer
recipe addendum, then authorize the separately prebound adapter/control freeze
and component run (or redirect to actual HTML34 when Raman is ready). This seal
alone does not authorize a hidden profile change or certify any held prerequisite.
