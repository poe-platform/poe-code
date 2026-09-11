# Foreign host array admission

## Evidence

Public input and host-return regression tests both rejected VM-created `[1,2,3]` arrays. Array admission unnecessarily required identity with the local Array.prototype after already checking Array.isArray. This also blocked the members of foreign AggregateErrors.

## Correction

Use the realm-independent Array.isArray classification for the existing data-copy route. Copy own descriptors using the existing validation, budgeting, and alias map; normalize the resulting array to the sandbox array prototype. Host subclass and custom prototypes are not imported. Keep the separate sandbox-value fast-path predicate unchanged so foreign values still pass through host conversion.

This change does not introduce a new proxy policy or relax the existing error-data capability restrictions. It removes only the array-prototype identity gate.

## Validation

- Foreign host input and callback-return arrays.
- Sparse arrays, hidden indices, self-cycles, and subclass prototype normalization.
- Own accessor rejection without execution.
- Host bridge, host-error identity, and source exception boundary/validation suites.
- Changed-file lint, maintained SafeJS build closure, built-import checks, and native Node 18 probe.

## Follow-up

Reapply the separately validated AggregateError member-payload correction after this dependency is committed and verified on remote main.
