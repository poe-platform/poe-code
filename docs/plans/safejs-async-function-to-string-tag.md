# Async function tag deletion

Two native regression cases fail before repair: ordinary and bound async
functions retain a synthetic AsyncFunction tag after their prototype tag is
deleted. Five installed-tag, generator and non-string controls pass.

Callable objects have Function as their built-in fallback. Async/generator
names come from actual Symbol.toStringTag properties, not closure metadata or
bound-target traversal. Replace only that synthetic callable fallback and
verify installed tags, deletion, bound functions, snapshots, legacy profiles,
TypeScript and lint. The current full candidate stays frozen and excludes this
followup. It depends on the local async-function prototype implementation;
do not stage it as a standalone change against a base missing that prototype.

Removing the synthetic fallback exposed a second masked defect: bind copied
only explicitly assigned prototypes, so async functions' implicit intrinsic
prototype was lost. The initial validation passed 112 cases and failed the
unchanged default bound-async tag control. Two dedicated native identity and
metadata-getter-order tests then failed before repairing bind.

Preserve any resolved non-null prototype (and explicitly assigned null), and
retain that selected prototype through length/name getters. Do not invent a
prototype for legacy low-level calls lacking a realm and an explicit link.
Snapshot checks cover deleted and installed tags plus bound prototype identity.

Final focused runtime/snapshot/prototype checks pass all 90 tests. TypeScript
passes (rechecked after the previous process handle expired), and focused lint
passes. The full candidate still excludes this dependent followup.
