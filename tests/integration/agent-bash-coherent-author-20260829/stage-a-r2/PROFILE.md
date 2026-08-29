# Stage A r2: physical-path-only trusted producer

Source3adc/309 and fixture seal4911f32f remain unchanged. Old r1 captures/root
are read-only. The common supervisor is byte-identical except its evidence
namespace. Producer code changes only root creation/admission: a new physical
root is verified against its alias's device/inode. All existing child entry,
cwd, HOME/TMPDIR/PATH, npm config/cache/pack paths, permission roots and output
receipts already derive from this one root and therefore use physical spelling.
No parent-directory allowance, preserve-symlinks flag, synthetic package boundary
or new permission/tool route. Absolute source/tool/executable identities remain
separate from relative manifest member/display fields; no blind spread changes
an authenticated locator. Exact source and tool graphs are unmodified.

Pinned Node22.22.2/TS5.9.3/npm10.9.7,2274 regular tool files plus12 pinned npm
aliases. Fresh preflight verifies original identities, absent relevant lifecycle
scripts and source309. Empty owned npm user/global configs, offline mode, no
ambient NODE_OPTIONS/proxies or dependency install. No network requested; this
trusted-tools profile does not claim a new OS network sandbox.

Conditional one producer attempt ONLY after this preseal is committed. Same
strict build/offline scripts-disabled pack commands and Node permissions as
r1, now using the physical root. No TypeScript consumer, extraction/install,
product import, semantic case, Worker, loader thread, engine/PUBLIC95, oracle or
Stage B activation. One production build;120s build/120s pack;1200s inclusive
total including publication,32 known processes/peak3;64MiB capture/768MiB work.
Encoded pack16MiB/decoded64MiB/accounted simultaneous data buffers96MiB, not RSS.

After producer exit/close/group absence, stream-hash the new regular output
into its frozen receipt BEFORE bounded same-Buffer inflation. Full member
path/type/mode/hash census must match source/emitted shipping inputs;1014 is
only a prediction until checked. No replacement of presealed expected hashes.
Unknown permission, integrity/capture/deadline/retirement stops dependent work
without widening/retry. Ordinary captured compiler errors do not authorize any
product-source change. Stage B needs independent review and fresh ROOT GO.
