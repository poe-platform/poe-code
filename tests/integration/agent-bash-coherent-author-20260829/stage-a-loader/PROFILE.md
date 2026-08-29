# Same-authority loader diagnosis: two harmless fixtures

Exact pinned Node22.22.2 only. No compiler/npm/product imports, builds, packs,
Workers, engine, native oracle or Stage B execution. Parent fixture preparation
may use development Git metadata and HTTPS retrieval of six official Node
v22.22.2 source files, each at most512KiB; no other source/host file discovery.

L01: reproduce alias-path permission/argv shape under a new owned `/tmp` root.
L02: change only route spelling to that root's verified physical pathname,
including permission roots, entry/cwd/HOME/TMPDIR. Never grant `/tmp`, `/private`,
or any unowned ancestor recursive reads. Match file device/inode before/after.
No synthetic package boundary: copy EXACT authenticated TypeScript package.json
(without a type field) at tools/typescript/package.json. The authored harmless
`.js` entry at tools/typescript/lib/tsc.js requires a harmless local `.js` payload;
this tests the CJS main/relative-load topology, NOT TypeScript compile-cache,
compiler imports/type resolution, npm or all future package-scope branches.

Expected L01: status1 with FileSystemRead `/tmp`, no entry receipt. Expected L02:
status0 and one nonce/source-hash/main-path receipt. Parent admits file type,
size/hash, copies the same bytes, verifies exact copies, and freezes dispatch
identity before spawning. Capture files are open first. Both children use the
unchanged permission mode; subprocess/addon/Worker permission absent, empty
PATH and sanitized env; no network requested by the literal fixtures.

At most2 children,20s each,300s whole probe,1MiB capture,16MiB temporary work.
Known detached group TERM on failure, KILL after2s, explicit UNKNOWN after5s;
exit+close+group absence required, no inference of hard kernel drain. Unknown
authority, integrity/capture/deadline/retirement stops further probes without
retry. Fixture root is retained; old Stage A root is read-only and untouched.
