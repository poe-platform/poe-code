---
title: Scoped RegExp modifiers
---

Implement scoped `i`, `m`, and `s` additions/removals using group-local flags.
Validate rejected valid patterns with failing tests before implementation. The
installed Node 22 lacks modifier groups, so use equivalent native patterns and
explicit controls derived from current ECMAScript semantics.

Reference: [ECMAScript RegExp semantics](https://tc39.es/ecma262/multipage/text-processing.html).

Requirements:

- Modifiers affect only their group's body, including lookarounds and references.
- Nested groups inherit current flags and restore the enclosing scope on exit.
- Public regex flags remain unchanged; modifier groups do not capture.
- Reject duplicate, overlapping, unknown, unbounded, or empty-minus modifiers.
- Retain compilation depth/work/memory limits and the shared backtracking ceiling.
- Verify checkpoint replay, capture numbering, Unicode modes, replacement, and public flags.

Follow the SafeJS harness skill: inline schema, async entry point with frontmatter,
no agent spawns or capabilities. Run package tests, lint, types, selected build,
then the screenshot CLI and inspect its image. Commit/push the atomic improvement
to main and monitor release publication while proceeding to remaining gaps.

Legacy regex grammar and wider JavaScript built-ins remain under audit; this
change is not proof of full JavaScript parity.
