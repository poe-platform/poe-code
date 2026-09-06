---
title: Collection subclass prototypes and class checkpoints
---

## Validated collection failures

Four initial tests showed that Map/Set subclasses lost their derived prototype,
failed instanceof checks and could not call subclass methods. Constructor
population now installs new.target.prototype before resolving the adder. The
derived adder sees its derived receiver before instance fields are initialized.

Prototype mutation now uses the collection's guest property table for
extensibility checks. Map/Set instanceof checks use the prototype chain instead
of trusting only the storage brand; removing the prototype no longer reports a
false positive.

## Class checkpoint implementation

Collection graph capture is shared by public dumps and low-level snapshots.
Explicit prototype references are serialized and validated, and restored before
own descriptors can make the collection non-extensible. Replay data still
rejects custom non-null prototype graphs; explicit null prototypes are retained.

Eight runtime cases passed while four subclass checkpoint cases failed. Investigation
with temporary diagnostic paths located the failure at bindings.Derived, not
the collection itself. Two standalone Plain-class probes reproduce the same
failure. The temporary diagnostic edit was removed.

Class constructors were sandbox closures without the origin metadata used by
ordinary function serialization. The existing
default-class checkpoint test replaces the class binding with an arrow before
dumping, so it does not establish class constructor persistence.

Constructor creation is now separated from class-definition evaluation. Class
origins retain the class AST, lexical scope and resolved instance-field keys.
Completed classes serialize as guest-class nodes with descriptors and prototype
links. Restoration allocates constructors and hydrates fields and object state
without rerunning computed keys or static blocks. Incomplete class definitions
are explicitly rejected instead of being replayed as complete definitions.

Class-node validation checks field ordering, source ownership, noncomputed keys,
scope references and immutable prototype descriptors. Two malformed prototype
cases were first reproduced as accepted and now reject.

## Verification and delivery

- Existing class regression cohort after factory extraction: 213 passed.
- Class checkpoint tests: 11 passed, including direct low-level restoration,
  fresh Map subclass construction and seven malformed-state cases.
- Collection subclass tests: 12 passed, including four public checkpoints.
- Scoped lint and TypeScript pass. The first full package run passed 16,540
  tests with one version-1 dump-schema regression. Public collection nodes are
  now restricted to version 2; the unchanged version-1 rejection test passes.
  Final full package run: 16,541 passed, 41 skipped (466 passed files, one
  skipped). The original version-1 rejection test remains unchanged.
- Selected workspace build passed, including four built-import checks. The real
  CLI harness passed and its screenshot was visually inspected; its root build
  completed all 70 tasks uncached.

## Remaining checkpoint requirements

- Active class-definition/instance-construction continuations need separate
  state capture; completed class records must not imply those are supported.
- Data-only copy/replay boundaries still reject custom non-null prototype graphs.
- Two next-issue tests reproduce invalid rejection of assigning a frozen Map/Set
  its existing prototype. They were added after the full green run and stay
  outside this commit.

The broader JavaScript-completeness goal remains active.
