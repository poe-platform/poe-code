# K08 archive-admission v3: ready for delta review, NOT actual GO

## Root cause and immutable history

The inherited preexec-v4/parse-manifest.mjs:4 hard-codes expected.length !== 1002 in the same diagnostic as decoded alignment; its terminator check also hard-codes seen.size !== 1002. The sealed shipping list and actual package contain **1006** members. Actual decoded size is 5803008, remainder **0** modulo512. Thus the count literal—not alignment—caused the retained early STOP. This is not a product failure or observed package drift.

Preserve 8f95143ed893784285e51a2c7a10d42a61ba884c: 0/71 calls, all UNRUN; owner primary, collector OWNER_RESULT_QUALIFICATION, and collector descendantSettlement UNKNOWN stay unchanged. Earlier B35 51/54, legacy24/24 and 2MiB publication STOP remain historical.

## Repair and author DATA evidence

Future target-owner.mjs imports owner-archive.mjs and calls admitOwnerArchive(seal), exactly the function exercised by A01/A02. It reuses byte-identical package-admission.mjs for regular-file/type/size/NOFOLLOW/identity/hash-before-decode; the original admitted compressed Buffer is passed directly into gunzipSync. No archive extraction or product import occurs in controls.

The new validator derives both count checks from sealed archive.shippingMembers (1006), requires unique manifest/actual paths, exact fullset and per-file size/mode/SHA256, and separates fixed diagnostic codes with bounded expected/actual counts, decodedBytes, alignmentRemainder and memberIndex. Producer-source USTAR/version/regular-file/zero-padding requirements were confirmed against actual bytes, not assumed generically.

Second/final PURE helper: **8/8 groups**. Actual package:981948 compressed bytes, 5803008 decoded,5037566 payload,249346 zero data-padding bytes,1024 zero terminator bytes. Wrong type/size/hash produce zero decoder calls; synthetic controls cover stale/missing/duplicate manifest, alignment/truncation, unexpected/duplicate-extra/missing actual member, payload/mode and USTAR/type/link/path/padding failures. Fourteen harness modules receive syntax-only parsing, no evaluation. The first helper exited with captured SyntaxError before any group or decode (A08 callback lacked async); its bytes/preseal/result remain, corrected control-v2 is separately sealed. No third helper.

Canonical paths, raw-primary/secondary and owner-result qualification, inherited deadlines, M01 loaded-helper discrimination, case inputs and product bytes are unchanged. Only archive routing/typed diagnostics, new namespace/capture/target paths, and explicit v3 activation identifiers differ. DELTA-DIAGNOSIS.json binds every old/new file identity. Inherited finalization.mjs stays d65f1c5f70069828b8c6417186b6d0abd76c3e27f48e9053b091c495f7a550b6.

## Sealed candidate and pending execution

- Source: ffac894aa98b8cd98476b8ea109ef2e2425c2a07; package SHA 0b6ae3340691c1c91b26f40454b8095d2ed346389353aa93e9a43c64d5a1132c,981948B.
- SEAL.json: 200923B SHA db262c234c02526f2864ef66d8e137e9cd9817645431d944ff3459ad3c89d9d9.
- GO.template.json and REVIEW.template.json remain PENDING with no dates; COMMAND.pending.txt requires fresh approved hashes, not executable authorization.
- Future capture: /private/tmp/safe-bash-k08-author-RAvH2m/future-v3-capture, preprovisioned empty; installed/moved/mutant-v3 roots checked absent.
- Unchanged future plan:69 primary +2 mutant Shell calls,3 baseline helper batches +1 mutant helper batch,2 binding refusals;79 runtime +7 administration =86 known OS starts,peak3;25min inclusive,60s finalization;96MiB capture,512MiB logical work. No build/install/compiler/type rerun in this matrix. Zero case subprocess/Worker/async-loader permission.
- Historical source-built app is reused only as authenticated source-built input; new installed/moved roots are separate. No stale window or old capture reuse.

Different review must check exact owner integration and reseal before ROOT grants any actual attempt. All 71 product calls remain UNRUN under this packet. No native/compiler/Worker/network/engine execution, no product/source change, no overall acceptance claim.
