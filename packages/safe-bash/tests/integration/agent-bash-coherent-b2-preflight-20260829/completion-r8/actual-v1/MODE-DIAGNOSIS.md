# B2-r8 installed-mode diagnosis — SOURCE/DATA only

Historical STOP `8433c2e0aa7d1c6944e94952224322f3ba6e1b11` remains unchanged: 224 PASS, 448 UNRUN; two type roles/eight exact negative diagnostics completed. Installation exited zero, but the subsequent package closure rejected all 1014 installed regular-file modes: expected 0644, observed 0600. Names, sizes and hashes matched. No product failure or successful moved-layout execution is inferred.

## Cause

The bound `staged/new/launch.sh:2` explicitly sets process umask 077. The coordinator inherits it through the owner into npm; its install argument list at `coordinator.mjs:63` does not override process umask. The closure at line 68 nevertheless compares installed modes to the archive's unmasked 0644 profile. Thus the refusal is a harness installation-profile contradiction, not damaged package content.

Pinned pacote makes ordinary file modes at least 0666, tar passes that creation mode to its file stream, and the inherited OS mask produces `0666 & ~0077 = 0600`. For this all-0644 archive, `archiveMode & ~0077` also equals 0600; it must not be generalized to arbitrary archive modes because pacote first transforms them.

Authenticated against `staged/metadata/RECIPE.json` toolInventory on 2026-08-29, using bounded regular-file reads:

| Tool-relative source | Bytes | SHA-256 | Relevant source |
| --- | ---: | --- | --- |
| npm/node_modules/pacote/lib/fetcher.js | 16849 | 1a385341f75d6c77496d30e7751012ad91489bb8c4e4e4db5e4568d2b9432a79 | 418 transforms mode; 425 noChmod; 431 assigns entry mode |
| npm/node_modules/tar/dist/commonjs/unpack.js | 36929 | 28af0e9e1cba6fe19a15bc5ea985c1ceeb9c79fda76e430daffc34fe9dff8083 | 450–458 passes entry mode to WriteStream |
| npm/node_modules/@npmcli/config/lib/definitions/definitions.js | 73801 | 4eb277f5649c00d5672059a4e61747660d60f72f4335cf1c197b52b4b20a72fe | 2056–2073: npm umask defaults zero and adds to, not overrides, OS umask |

The actual mode evidence is the preserved actual-v1 postguard payload, not a new installation. The package SHA remains `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`. No mode repair was performed.

## Minimal prospective repair proposal — NOT implemented

Keep launcher/captures at 077/0600. Version only the coordinator's installed and physically-moved package closure mode expectation to the exact declared installer profile: for this authenticated all-0644, non-executable archive and pinned npm toolchain, expected mode is `archiveMode & ~0077` (0600), with strict archive-profile admission and unchanged name/size/hash checks. Source and explicitly materialized mutant-copy modes retain their existing exact checks. This is a deterministic derivation, not an allowed-mode set.

An alternative is an installer-only process umask 022, with every capture still explicitly created 0600. Merely adding npm `--umask=022` is insufficient: it cannot restore bits removed by inherited OS umask 077. That alternative requires a separately bound installer startup change and is not proposed as an unreviewed fix.

`coordinator.mjs:72` physically moves the installed directory using rename, then checks device/inode identity at lines 73–75. Such a move would retain installed file modes; the actual r8 run never reached it, so this is source reasoning, not moved-layout observation.

Prospective scope: versioned coordinator closure/profile metadata and focused derivation/refusal controls; no product/VFS source or existing raw artifacts. A continuation would have 448 semantic cells remaining, four type roles/16 diagnostics, seven mutants/seven restores/two bindings; a fresh full replay would still be separately counted as 672. Neither is authorized here. Host package-layout permissions are distinct from user virtual-filesystem modes.

This diagnosis executes no npm, compiler, product, Worker or native oracle. It does not claim generic npm mode preservation or rescore historical results.
