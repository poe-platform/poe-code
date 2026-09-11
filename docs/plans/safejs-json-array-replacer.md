---
title: Array-form JSON replacers
---

Native comparisons confirmed that the sandbox rejected array-form replacers and
other non-callable replacer values. Construct a property list from arrays before
serializing: capture length, read indices in order, accept strings/numbers and
their boxed forms, apply observable string conversion, and deduplicate resulting
keys without reordering. Ignore other non-callable replacer inputs.

Use the property list for object serialization, including requested inherited
and non-enumerable properties. Arrays still serialize their indexed elements.
Preserve getter/conversion order, mutations during list construction, and the
independence of the completed property list from later input mutations.

Meter each input entry, bound generated strings and list length, reserve temporary
list storage before growth, and release reservations on errors and completion.
Validate native comparisons and budget cleanup, package unit tests, lint, types,
selected workspace build, and the no-capability skill-guided harness with actual
screenshot inspection. Commit/push this improvement separately to main.

JSON spacing-option normalization remains a separate audit; this change does not
claim full JSON or JavaScript conformance.
