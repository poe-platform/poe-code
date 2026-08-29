# Producer-v2: one offline pack, no rebuild or execution

ROOT fresh10min/24known-OS/peak2/48MiBcapture/256MiBwork grant. Preserve original
22260dd7 config failure. Exact selected shipping tree da4e1cc187022255521879b00db2ac77674f79d9,
305 inputs, retained1305 source/compiled files and48 private assets. No B35/HEAD.

runner.mjs seal authenticates the committed original SOURCE-REPORT via individual
Git blob lookup, its complete compiled/source/tool manifests, the exact Node binary,
241 TypeScript files and complete npm10.9.7 tree including12 contained symlinks.
The producer uses distinct owned EMPTY regular user.npmrc/global.npmrc; both real
paths/inodes/modes/hash are sealed. Exact argv/environment contain no inherited
npm settings; HOME/cache/configs are owned and project source is exhaustively bound.
Only npm pack --offline --ignore-scripts --json is executed once, never install.

Producer JSON size/SHA1/SHA512 are checked by a bounded streaming archive digest.
Actual archive bytes and receipt are COMMITTED before the first full-buffer read.
Then O_NOFOLLOW/open/fstat/exact-size bounded read and same-Buffer hashes precede
gunzip(maxOutputLength=64MiB). Compressed cap16MiB; tar header checksums, safe
regular-member paths, exact inventory/mode/size/hash match the compiled shipping
set; all public export targets and private48 assets are bound. No archive extraction
or product import occurs. Postguards verify complete source/compiled/tool closures.

Roles: A01 startup/context; A02 index-before; A03 patch shell/A04 apply_patch;
A05 seal coordinator; A06 stored authority Git; A07 intent/A08 preseal commit;
A09 producer coordinator; A10 sole npm; A11 intent/A12 archive-receipt commit;
A13 publication patch shell/A14 apply_patch; A15 publication coordinator;
A16 intent/A17 evidence commit/A18 index-after. These18 are planned roles,
not automatic results; actual receipts and final census govern. Shell exec replaces
the shell process for Node coordinators. No invisible-transitive census claim.

Capture before admission and spawn, enrollment before fallible publication; child
60s/max8MiB local capture; fresh600s includes final publication. Safety/integrity/
capture/unknown-retirement/deadline stops without additional producer. No compiler,
Workers, runtime imports, engine, Shell, native oracle, private engine or network.
All70 integration obligations stay UNRUN; no transport runtime acceptance inferred.
