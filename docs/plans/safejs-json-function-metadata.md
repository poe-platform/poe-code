---
title: JSON function metadata and snapshots
---

## Validated gaps

Eight initial tests failed: JSON methods lacked public names and could not accept
ordinary metadata changes. JSON.stringify also advertised the wrong arity.
Expanded tests exposed rejection of mutated methods in direct in-memory snapshots,
although their serialized checkpoints could already be restored.

## Implementation

Use the existing guest-managed function property model for the four JSON methods.
Register their trusted JSON-qualified identities before tracking descriptor state,
and keep existing identities when registering intrinsic functions. Names remain
independent of checkpoint identity; changing a public name does not rename its
trusted installation path.

Mark runtime-produced snapshots by object identity. When such a snapshot has
unsupported in-memory descriptor state, convert it through the existing dump
format and apply the normal validation pipeline. Do not extend this fallback to
caller-forged wrappers. Keep the original snapshot object locked during resume,
including when restoration produces a normalized copy.

## Verification

- 22 metadata tests cover names, arity, descriptors, mutations, stable old IDs,
  pending/completed serialized and direct checkpoints, provenance and reentry.
- Metadata, URI and legacy checkpoint cohort: 142 passed, 1 skipped.
- Function/prototype compatibility cases now verify successful direct resume
  against the original serialized graph, rather than expecting rejection. Their
  separate unsupported replay-data checks remain unchanged. This cohort and the
  metadata tests pass 69 cases.
- Maintained package tests pass: 16,080 passed, 41 skipped. Scoped ESLint and
  TypeScript checks pass.
- Run maintained package tests, scoped lint/types, selected build and this CLI
  harness; inspect the screenshot before committing and pushing.
- Selected workspace build passes. The real CLI harness passes with zero spawns,
  and its screenshot was inspected.

## Next validated gap

Object.keys(JSON) exposes the four built-in methods, JSON[Symbol.toStringTag] is
undefined, and Object.prototype.toString.call(JSON) returns [object Object].
The namespace's property attributes and string tag need a separate atomic fix.
