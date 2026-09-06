---
title: Non-extensible prototype no-ops
---

Assigning an object's current prototype must succeed even after freeze, seal,
or preventExtensions. Expanded regression tests reproduced 16 failures across
Map, Set, ordinary objects, arrays, regexes and budget-free null metadata.

Compare the effective prototype before checking extensibility. Preserve explicit
null metadata used by snapshot serialization, without recording unnecessary
non-null default prototype links. Genuine changes still reject.

Validation: run the focused prototype and null-snapshot tests, the SafeJS
workspace unit suite, scoped lint and type checks, then the selected workspace
build. Run this harness through the CLI and inspect its screenshot. No agents
or external capabilities are required.

Results: 61 focused tests passed; the workspace suite passed 16,578 tests with
41 skipped. Scoped lint, TypeScript and the selected workspace build passed.
The real CLI harness passed; its screenshot was visually inspected. Its root
build completed all 70 tasks uncached.

Next validated gap (separate improvement): Object.create(new Map()) and
Object.create(new Set()) reject valid collection instances as prototypes.
Native JavaScript inherits their own properties; SafeJS rejects the links.
