---
title: RegExp intrinsic prototype and derived construction
---

# RegExp intrinsic prototype and derived construction

## Validated baseline

The native-comparison suite in `regex-prototype.test.ts` checks constructor and
prototype identity, shared method identity, constructor/prototype descriptors,
method lengths, prototype accessors, borrowed methods, inherited mutation, and
one- and two-level subclass construction. Native JavaScript evaluates every case
successfully. SafeJS has no exposed RegExp.prototype; derived construction fails
with `TypeError: Class extends value has an invalid prototype`.

The initial run had sixteen failures and one misleading passing exception test:
reading the missing prototype threw before the borrowed exec call. Move that
lookup outside the try block so it cannot count an unrelated exception as proof.

## Implementation requirements

- Install a per-budget ordinary RegExp prototype with Object.prototype as its
  parent. Do not represent RegExp.prototype as a compiled regex.
- Give literals and constructed regexes the same default intrinsic prototype,
  without recording every default instance as a custom-prototype object.
- Register the constructor using the maintained intrinsic constructor machinery.
  Preserve descriptor flags and shared method identities.
- Expose source, flags, and flag getters with safe accessor adapters; preserve
  generic flags behavior and prototype receiver exceptions.
- Honor newTarget.prototype for derived construction and retain prototype values
  across any guest reads or coercions. Remove the temporary constructor fallback
  added by the preceding identity fix once ordinary lookup supplies it.
- Ensure interpreter call fast paths, string methods, and coercion respect
  inherited method changes and deletion instead of resurrecting virtual methods.
- Preserve default regex copy, snapshot, and replay behavior. Explicit custom
  prototype graphs remain an unfinished compatibility requirement, not proof of
  complete JavaScript support; never silently discard them during persistence.
- Account for intrinsic mutations, including symbol keys and accessor closures,
  under existing data and step budgets.

## Verification

Run the native comparison suite to red before implementation, then expand with
mutation/deletion, lifetime, and persistence controls. Run the maintained SafeJS
unit route, changed-file lint, package type check, and selected workspace build.
Add a capability-free SafeJS harness pair and inspect its screenshot before
committing the atomic implementation and pushing to main. Continue other
validated work while the release workflows run.

Species construction and exposed symbol protocols remain required subsequent
work; a prototype identity fix alone does not complete RegExp compatibility.

## Implementation evidence

The seventeen original comparisons and four further mutation/deletion cases now
pass. The latter exposed virtual-method resurrection, ignored inherited string
conversion, deleted getter assignment, and null-prototype lookup problems.
An additional symbol-keyed mutation test reproduced missing retained data; the
intrinsic descriptor tracker now includes symbol keys. Its 6,000-byte rejection
and 14,000-byte success controls pass without changing either limit.

Default string regex operations compare current descriptors with the registered
intrinsic descriptors before selecting the existing fast path. This preserves
the existing cursor-retention and 1,000-step replacement controls while allowing
observable inherited overrides and deletion.

An older class test incorrectly required super.source assignment to throw.
Native JavaScript creates a display property without changing compiled matching;
the corrected test compares both the display value and matching behavior.

The maintained package suite passed 14,382 tests with 41 skipped. Changed-file
lint and package types passed. Default regex persistence tests remain green;
portable custom-prototype persistence is still incomplete and rejected by the
snapshot/export guards. The harness performs no capability calls or agent spawns.
