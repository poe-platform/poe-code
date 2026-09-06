---
title: RegExp identity and regex-like construction
---

Ten failing native comparisons established ignored Symbol.match and constructor
overrides, incorrect identity reuse, and missing regex-like source/flags reads.

Evaluate IsRegExp through Symbol.match without primitive coercion. For calls
without explicit flags, return an existing regex-like input only when its
constructor is the current RegExp constructor. Construction with new and calls
with explicit flags skip that constructor read. Preserve compile admission
before any guest hooks or identity shortcut.

Branded regex copies use internal pattern data even when Symbol.match is false.
Other regex-like inputs read source and then flags before coercing either.
Hold detached getter results across subsequent reads and coercion; clear raw
source retention after conversion. Existing budget limits remain unchanged.

Validate through maintained safe-js unit tests, focused native and retention
checks, changed-file lint, package types, selected workspace build, and this
harness pair with screenshot inspection. No capabilities or agent spawns.

The existing implicit constructor default is preserved until the actual RegExp
prototype graph is exposed. Full intrinsic prototype identity, newTarget-based
subclass prototypes, species construction, and portable prototype snapshots
remain separate work; this change does not claim those are implemented.

Next reproduced cases: /a/.constructor === RegExp and
Object.getPrototypeOf(/a/) === RegExp.prototype are true natively but false in
SafeJS. A derived class extending RegExp constructs and matches natively, but
the SafeJS probe fails. Address the intrinsic prototype graph and derived
construction together with their identity and persistence requirements.
