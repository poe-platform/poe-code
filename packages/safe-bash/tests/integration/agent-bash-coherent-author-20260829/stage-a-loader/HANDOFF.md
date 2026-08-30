# Loader source diagnosis; harmless probes blocked before launch

2026-08-29. Preseal commit `24971010f60792576268c425ce6cff8fc560bd83`;
preseal SHA256 `cf07bed631f05f83db4a06b7058a0e6fb8a6a67672d0c0007ef0308291e8dc66`
(2,670 bytes). Original Stage A f89cfd7a/0cd47070 remains unchanged. Selected
source3adc/309 unchanged; no compiler/build/pack/product/engine/Stage B retry.

## Source-supported origin of the original denial

Six official Node v22.22.2 files were fetched from the exact tagged primary
repository URLs recorded in PRIMARY.json, bounded to512KiB each, then hashed.
This is tagged source provenance, not a reproducible-build attestation of the
installed executable. Its exact binary hash/size was independently rechecked.

The original stack's `node:fs:2815` matches `lib/fs.js` line2815 exactly:
realpathSync has already lstat'ed the current path component and established
that it is a symbolic link; it calls binding.stat on that component before
reading/resolving the link. The captured component was `/tmp`. Metadata-only
checks show `/tmp` is a symlink and resolves to `/private/tmp`.

`lib/internal/modules/run_main.js:39` invokes Module._findPath; the main-file
branch `lib/internal/modules/cjs/loader.js:746` invokes toRealPath, which calls
fs.realpathSync at `lib/internal/modules/helpers.js:61`. The synchronous Stat
binding in `src/node_file.cc:1103` checks FileSystemRead for the supplied path
before calling uv_fs_stat. This matches the recorded failure before entry load.
Thus the OBSERVED original `/tmp` denial is the symlink-component stat path,
not evidence of package-scope ancestor lookup. Other later loader/package
branches are not exonerated, and no kernel cause is guessed.

TOPOLOGY.json records source309 reauthentication, all2,274 retained regular
tool file hashes,12 exact contained npm link targets, and only explicitly
declared parent metadata. TypeScript's authenticated package.json is3,620 bytes
and has no type field. No private/user source file inspection occurred.

## New integrity STOP: zero fixture executions

The probe helper completed its source admission, created an empty owned capsule
directory skeleton, then rejected the package source locator BEFORE opening or
parsing its bytes: actual file size5,387 versus expected3,620. The bad sealed
locator was `package.json` rather than the intended absolute retained TypeScript
package path. It therefore referred to the current safe-bash package metadata.

The source cause is exact object-key order in prepare.mjs:

`typescriptPackage:{path:path.join(retained,'tools/typescript/package.json'),...pkgRow}`

The later `pkgRow.path` overwrites the absolute path. The same construction is
present for typescriptEntry, though that field was NOT used by this attempt.
This is a harness locator defect, not a product or Node-loader result. The
regular-file/exact-size guard refused before content read. STOP.json records
spawnCount0/captureBytes0/completed[]; outer status1. Neither L01 nor L02 ran.
The syntax check and helper completed; there were no fixture PIDs, signals,
exit/close results or retirement proof to credit. No retry under this grant.
The new capsule is retained at `/private/tmp/safe-bash-stage-a-loader-20260829-r1`.

## Minimal prospective changes; NOT applied

1. Version the locator schema with separate `sourcePath` (absolute) and
   `relativePath` fields, both explicitly asserted before file access. Bind the
   existing exact package/entry size/hash; do not replace expected bytes with
   the observed unrelated package. Preseal a new namespace and input hashes.
2. Re-run at most the two original harmless fixture identities only after
   fresh ROOT authorization. L01 preserves alias spelling; L02 uses the
   verified physical owned root for entry, cwd, HOME/TMPDIR and permission roots.
   Keep the exact authenticated TypeScript package.json; add no package boundary.
3. If independently accepted, propose producer-only routing through the same
   root's physical path. Read/write authority remains the same directory inode,
   not generic `/tmp` or `/private` access. Do not use preserve-symlinks flags,
   change Node version, disable permissions or widen recursive parent reads.

The two literal fixtures intentionally model only `.js` CJS main plus relative
local `.js` loading, not compiler compile-cache/import/type resolution or npm.
Even successful fixture results would not establish producer completion. A
successor producer preseal must separately rebind root topology, all command
paths/cwd/env, tool/compiled/source inventories and output-receipt protocol.
Existing producer source, f5 gates and all semantic/engine work remain untouched.

The transient source-proof phase addition to outer.sh was restored byte-exactly
before the committed probe preseal. Its captured inspection is not a fixture
execution. Historical preseal/output captures and the new STOP are preserved;
no result is rescored and no current acceptance is inferred.
