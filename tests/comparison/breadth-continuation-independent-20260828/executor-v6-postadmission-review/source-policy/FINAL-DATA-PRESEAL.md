# Final bounded DATA cross-check preseal

Before execution, require the 21 authenticated receipt `nextLoad` records to
agree directly with their config/source entries on path, bytes and SHA256, not
just with diagnosis metadata. Require their source paths to remain exactly the
same set as the original 21-source check. Recheck all previously authenticated
files before and after; this still does not detect new namespace entries.

Capture only bounded, named AST excerpts from already authenticated
chunk-ZBUZKIPX.js: top-level imports, the P/m/A initialization statement and its
following if/try/catch, function S (its separate UUID helper), function I
(registerHooks feature detection), and these named methods: applyPatches,
applyPatch, restorePatches, createBlockingProxy, protectDynamicImport,
protectModuleMethod. Cap every excerpt at 2000 bytes and the output at 262144.
Record full-node byte endpoints and truncation explicitly. This is read-only
context extraction, not method execution or proof those methods run at import.

The supplemental spelling-based context list is not symbol-resolution evidence:
its local array name `a` collides with other spellings and its substring filter
is broad. Do not use that list to infer binding identity or call reachability.
The original main-bundle Mf/e/t/Ks symbol checks remain separately applicable.

No changes to either prior result or preseal. No additional comparator inputs,
engine/product imports, native API probe, worker, archive, network, install,
execution staging, native oracle or policy implementation. Commit this preseal,
its checker and the existing supplemental results before the final DATA run.
