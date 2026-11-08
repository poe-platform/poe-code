# Compiled-prerequisite legacy replay v1

August 27, 2026. New AUTHOR verification profile only; candidate remains
`eba049535d154f4e028f57ffd8efd7622b2239ca`. Product, legacy assertions,
configuration and previous evidence are read-only. No private queries, pack,
install, root dist writes, external-service network, source fix or other-worker
output reuse is authorized. The earlier missing-dist profile in `f8fdae7289162494d09f887bed4846edfd6575cf`
remains exactly 487/505 pass, 18 fail (17 explicit missing worker; pipeline root
cause separately unclassified); remaining 203/type commands were not run.

1. Authenticate exact Git archive, all-src/nine-path digests, both frozen build
   configs and original four command receipts. Copy only the same seven complete
   regular tool packages, verifying their full inventories and three external
   executable hashes against the prior profile. No dependencies are installed.
2. Record all archived source/test/helper/config entries, copied tools and pinned
   compiler entry/implementation hashes. Build once with the frozen build script's
   equivalent direct command: `node node_modules/typescript/bin/tsc -p tsconfig.build.json`.
   Only fresh dist entries may be added; source/test/config/tool changes stop work.
3. Record canonical generated-artifact inventory and maps back to candidate source.
   Verify the emitted worker and its imports load, send their existing ready message,
   then close the bootstrap's parent port for natural exit. No regex request or new
   behavioral test is added. This readiness check is a prerequisite, not a test row.
4. Once build/output/readiness pass, run the original 27-entrypoint 505 command once,
   then only on success the six-entrypoint 203 command, focused noEmit and source-wide
   noEmit. Stop at any failure; no fixes, retries, skipped cases or oracle updates.
5. Seal raw output and additive qualification. Check source/test/config/tool and
   generated-artifact bytes/modes/entry sets before/after, including additions.
   Keep cohort rows separate from build/readiness/types and previous 42 checks.

The helper is an explicit historical `.data` replay, not canonical discovery.
Inputs come from eba, never the observed current HEAD. Full inventories do not
claim timestamps/xattrs/OS-library closure, atomicity or intervening-state proof.
Controlled environment matches the previous profile; per-command HOME/TMP is
isolated outside the guarded candidate. A 300-second own-process-group bound is
recorded, not opaque-work hard preemption or a host-wide handles audit. No active
Curie/public/private-worker files will be opened or awaited. Original five custom
first-read requirements remain separate and not measured here. No release/full
suite/global maintained-typecheck/independent acceptance is claimed.
