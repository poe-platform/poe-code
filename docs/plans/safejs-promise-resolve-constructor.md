---
title: Promise.resolve constructor lookup
---

Four regression tests reproduced Promise.resolve ignoring an input promise's
own constructor. Read the current constructor descriptor and invoke its getter
once. Reuse the input only when that value matches the resolve receiver; even
an object receiver that is not constructible may reuse an exactly matching
input without creating a capability. Getter errors propagate synchronously to
the guest caller. A different constructor creates a new promise.

The focused constructor, generic, compatibility and low-level promise cohorts
passed 212 tests across six files. Run scoped lint and types, the selected
workspace build and this real CLI harness, then inspect its screenshot. No
agents or external capabilities are required.

Scoped lint and TypeScript passed. The selected build passed four built-import
checks. The real CLI harness passed and its screenshot was visually inspected;
its root build completed all 70 tasks uncached.

Native promise property admission remains a separate policy question; no host
metadata is copied by this change.
