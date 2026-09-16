# Declarative Pandoc format registry

Implement only descriptor discovery, registry validation, dialect scanning and
lookup dispatch. Preserve the unrelated converter plan edit. Built-in format
modules declare contractual directions without advertising absent codecs.

1. Write original failing tests for aliases/collisions, deferred names, scanner
   toggles, inference, ordering, injected availability and dispatch.
2. Implement static format-module discovery and registry-derived capabilities.
3. Add SDK listing argument handling and a thin opt-in safe-bash listing adapter.
4. Run maintained scoped lint, typecheck, tests and workspace build closure.
5. Record evidence under docs/pandoc and commit task-owned files on main only.

QA: inspect descriptor coverage against contract.md; inspect generated public
exports; verify unavailable directions stay absent from listings. No conversion
codec implementation or full CLI option parser is included in this task.

Completed: static descriptors/discovery, registry/scanner, lookup dispatch,
SDK listings and opt-in inspection adapter. The maintained package test route
passed 91 tests; package lint/type checks and selected workspace build passed.
Visual output was captured and inspected; evidence is in
[docs/pandoc](../pandoc/format-registry-evidence.md). No push or release is authorized.
