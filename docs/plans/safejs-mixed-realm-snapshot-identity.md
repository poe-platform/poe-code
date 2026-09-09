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
