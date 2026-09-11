# Preserve symbol descriptor state in snapshots

A legacy-accessor checkpoint exposed an existing failure with symbol-keyed
accessors. Reproduce it independently using Object.defineProperty before changing
the shared object-state classifier. The current classifier enumerates only
string-named descriptors and can miss a symbol accessor, selecting a data-only
serialization route that rejects it.

Include guest symbol descriptors in state detection while keeping internal
symbols private. Verify descriptor flags, getter/setter identities, cycles, and
replay with object and array controls. Run focused snapshot/accessor regressions,
lint, and the maintained build before a separate commit and push. Do not include
the unfinished legacy-method or weak-collection changes.

## Verified fix

The independent Object.defineProperty object case failed with `Symbol accessor
properties cannot be serialized`; the array and three data-descriptor controls
passed. State detection now scans guest-visible own string and symbol keys,
excluding known internal symbols, and uses the existing guest-object descriptor
format. No snapshot schema or native-accessor admission rule changed.

All 1,462 tests in the 90-file snapshot directory pass, as do the 190 focused
snapshot/accessor tests. Focused lint passes. The maintained build passes its
23 selected workspaces and four fresh imports. Built Node 18.18.0 and Node
24.14.0 both replay object and array symbol getter/setter identities correctly.
No matching open GitHub issue was found. Legacy Object methods and weak
collections are not part of this delivery.
