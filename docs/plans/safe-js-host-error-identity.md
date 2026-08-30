# Preserve trusted host-call resumability errors

## Contract and scope

This follow-up starts from the frozen named-policy increment above published C,
not from local class/V8 work. A real native `HostCallResumabilityError` retains
its identity and `reset` or `external-reconciliation` action at the public
run/restore boundary. Guest recovery cannot suppress a genuine engine failure.
Engine-shaped data or prototype copies must not acquire that privilege.

The three production changes are deliberately small:

- Brand actual instances privately in the canonical `interp/host-call.ts` class.
  Preserve normal base/subclass `instanceof` behavior while rejecting prototype
  clones, copied descriptors and proxies that did not run the constructor.
- Preserve genuine errors before `interp/exceptions.ts` converts a captured
  native exception into a guest Error-shaped value.
- In `interp/host-bridge.ts`, do not settle a synchronous fatal engine failure as
  an ordinary rejected host outcome. The async path already avoids doing so.

No interpreter, Promise tracker, schema, filesystem, alias-name or registry
changes are needed. The first canonical identity for shared functions remains
the accepted contract. No wrappers or registry copies are added.

## TDD and validation

Preserve the strong public shape failure on six Nodes before implementation.
Add source/public regressions for sync, async, Promise and thenable throws;
module/binding policy conflicts; external reconciliation versus reset; exact
native identity; prototype/property/constructor impostors; ordinary errors;
guest catch/finally and Promise reactions; ordered cancellation; and repeated
checkpoint replay without an ordinary outcome for a fatal engine failure.

The initial three-file candidate also fixes the observed reaction boundary;
adding a fatal-tracker classification was considered but is unnecessary and is
not part of the implementation. Keep existing budget/reentry behavior unchanged.

Use isolated source and actual public-package fixtures on Node 18.18.2, 18.20.8,
20.19.2, 20.20.0, 22.22.2 and 24.14.0. Check the actual emitted declarations with
strict NodeNext/Bundler consumers. No source aliases substitute for the public
artifact proof; no full-suite or browser-runtime claim follows from these gates.

## Integration

Deliver separate old-path and canonical-path incremental patches. Apply after
the named-policy increment, and after the rename when using canonical paths.
Keep both prior freezes untouched. Feynman owns integration and release gates;
Halley receives the same bounded implementation for the later engine merge.
