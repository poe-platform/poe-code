# Mixed-realm intrinsic snapshot identity

## Reproduction

A read-only probe against the built isolated candidate reproduced an identity
loss (2db44c). Run `return Number.prototype` twice with separate `run()` calls.
Pass both returned values as bindings `a` and `b` to the low-level serializer,
JSON round-trip the result, then restore it with that source. The values are
distinct before serialization but identical after restoration:

```json
{"distinctBefore":true,"distinctAfter":false}
```

This is distinct from the single-realm prototype-parent fix. The serializer
records installation paths such as `["Number","prototype"]`, and restoration
resolves both paths against one budget's intrinsic table. The two heap nodes
therefore resolve to the same intrinsic object. The probe did not test public
SDK admission of foreign realm values, nor establish a public API guarantee
that accepts such inputs.

## Required follow-up

- Establish which supported transport paths can contain multiple originating
  realms, including host-held guest closures and low-level heap input.
- Add regression coverage for distinct prototypes, mutations, function realm
  defaults and aliases within each realm.
- Preserve originating realm identity for supported mixed-realm transport.
  This requires realm-qualified intrinsic references and reconstruction of each
  realm's intrinsic graph, rather than creating unrelated generic objects.
- Keep source/evaluator ownership, symbol registries, budgets and resource
  cleanup explicit. The current single-source snapshot format is not evidence
  that arbitrary mixed-source closure restoration is supported.
- If a transport intentionally excludes mixed realms, enforce that boundary
  explicitly; silent identity collapse is not a valid successful round-trip.
  Such rejection would document a remaining limitation, not complete realm
  transport support.

No implementation or conformance claim accompanies this inventory item.

## Current source and public admission checks

September 9 source probe 3d3288 reconfirmed the low-level collapse on current
main: `distinctBefore: true`, `distinctAfter: false`, while a third binding
aliasing the first prototype remained aliased after restoration. This narrows
the defect to cross-realm distinction, not general within-realm alias loss.

Phase-labelled public probes (94f06a) distinguish three paths:

- Direct `bindings: {a,b}` rejects during `run`, before a dump is attempted,
  because guest function properties and prototype links cannot be serialized.
- A registered module exporting `{a,b}` rejects during `run` for the same
  reason.
- A host function returning `[a,b]` executes successfully. Guest comparisons
  report the two values distinct from each other and from local Number.prototype.
  Dumping that completed run rejects because a callable needs an explicit resume
  capability. This probe did not supply such a capability or validate recovery
  with one.

The initial combined probe bbb604 did not label the failing phase. Follow-up
54589 terminated at the first direct-binding admission rejection; 94f06a adds
per-path catches and establishes the phases above. Do not report those public
rejections as successful dumps or as reproduced public silent identity loss.

The inspected package index exposes public dump/restore but not the low-level
serialize function. `interp/intrinsics.ts` records identities by installation
path in a WeakMap and resolves them through a per-Budget map. These facts explain
the low-level collision but do not establish a supported multi-source public
checkpoint contract. Next investigate explicit host resume capabilities and
realm ownership before choosing a format change; a rejection-only patch would
not fulfill mixed-realm transport support.

## Resume-provider boundary inspection

Source inspection distinguishes two mechanisms that the earlier follow-up
wording could conflate. `RunOptions.hostCallResumeProvider` reconciles pending
external operations: `HostCallJournal` calls it with an operation identity and
validates the returned outcome proof. It is not an arbitrary object/intrinsic
identity resolver for serialization.

Replay callable identities are registered internally. `host-bridge.ts`
registers injected native functions by their binding/module paths, and
`HostCallJournal.registerCallbackFunction` registers exported guest callbacks
against a recorded host call. `encodeReplayData` asks that journal for an
existing callable identity. Its low-level `identifyCapability` callback is
not a `RunOptions` field. Additionally, the guest-state/prototype-link guard
runs before callable identification; assigning a callable identity alone does
not admit an arbitrary foreign intrinsic graph.

These are source-level boundary findings, not a successful runtime recovery
probe. Do not treat supplying `hostCallResumeProvider` as a general fix for the
earlier completed-run dump rejection. The next runtime probe should use the
actual registered callback/binding paths and distinguish admission, dump and
recovery before changing the snapshot format. The isolated full-package test
candidate remains unchanged by this documentation follow-up.
