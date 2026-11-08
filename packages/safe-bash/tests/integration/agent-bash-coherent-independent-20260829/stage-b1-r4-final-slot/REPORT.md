# B1-r4 independent final-slot review

**ACCEPT_SCOPED_FINAL_SLOT_ONLY — not actual authorization.** Checked at **2026-08-29T15:06:02.082Z**.

Binding commit `5d8a638bb2320c1071d28d9aab1c1ed85e6a142e`; preseal commit `8f0908d54285e96eea86619c1e4ddd2338d8b9c0`. FINAL-BINDING is 29,531 bytes, SHA `3da56afc93588c0bdfa016d02341ed4d0e8e22cd3441d0ecea3f97651b97ccc1`.

Receipt: 6,208 bytes, SHA `242621c6c21d00b37516d9fcc19433b86ca11fb7672229422794ed10afb4f89f`. `AUTH.json` records the freshly admitted identities; `RECEIPT.json` records complete checked pins, absent paths and bounds.

## Verification

- All **55 runtime files**, **5 publisher files**, and **2 current helpers** match their size/hash pins. Runtime/publisher flat lists exactly equal the identities projected from their bound seals, in order; neither a sparse witness nor arbitrary flattening substitutes for membership.
- Both helper bodies are byte-exact to their accepted v5 origins. The current package and Node executable were streamed and hashed without decoding/extracting/executing either as product or native code.
- Runtime preseal 20,804B `a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70`; publication binding 3,872B `8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea`; publisher preseal 1,708B `034d23073d3442a0d2bafde999c3367922867926a41780596bd3f28611b94613` match.
- Four fixed controls passed: S01 actual flat helper iteration; S02 nested refusal before reader; S03 accessor refusal before reader; S04 current paths/window/slots. Only the authenticated PURE helper exports were called. Preimport main, publisher main, runtime, product and Workers were not executed.
- All **12 declared output/authority slots are absent**, checked with lstat so a dangling symlink is not treated as unused. No slot was populated by this review.
- Complete runtime argv targets r4 launch/PRESEAL and exact hash/size; publisher fixed prefix targets r4 publication/binding and the declared authority path; preimport targets the current final packet and the current helpers. Old pinned runtime/publisher records remain inactive provenance checks, not stale activated routes.

## Fixed window and future recipe

August 29, 2026 UTC: issued **15:01:24.888Z**, latest start **15:21:24.888Z**, expiry **15:51:24.888Z**. Latest-start-to-expiry is the full 1,800 seconds. The actual earlier inclusive 1,800-second deadline wins. This review creates no replacement window or actual grant.

The future author must obtain fresh ROOT actual GO and populate only the recipe's dynamic grant and measured-ledger identities from the exact written bytes. Authenticate the packet, both helpers, Node and runtime/publication inputs again before entry. Open owned preimport capture before fallible helper work. The ROOT grant, real prepublication ledger and resulting authority hashes/sizes are intentionally unpopulated; no placeholder becomes authorization by this acceptance.

The preimport ledger must describe actual observed retired starts plus its executing PID, not planned counts; after its exit/close there must be no intervening OS start before publisher dispatch. Authority size/hash must come from the same exclusively written Buffer. Publisher eligibility still requires measured retirement and remaining wall/capture/work headroom. No old census is rerun or substituted here, and no missing/partial RESULT becomes success.

Preserve **32 known OS/peak3, 1,800s inclusive, 64MiB capture/768MiB logical work**, guest15 total/live5, Regex0/async-loader0. The 15 calls and all earlier runtime failures/HOLDs remain unrescored and UNRUN in this review. The earlier `53ad11083d9e33fbcd5782672fde0d5dcb24180a` fixture/layout acceptance is reused, not expanded into runtime success.

## Review closure

One PURE DATA helper, one syntax child, no harmless fixtures, product/Worker/compiler/build/install/native or publisher-main execution. Nineteen known OS starts through final publication, peak at most two, within the fresh 20/peak3 grant. All observed sessions retired; no live cleanup task or descriptor is transferred. There is no universal OS census claim. Fixed review deadline: epoch milliseconds `1788016158973.988`.

An initial ordinary SOURCE read asked for a nonexistent standalone controls.mjs. Its tool transcript is preserved; controls were subsequently located in the bound prepare.mjs. That author main was never executed. This discovery error is not a product failure or a replayed safety stop.

Stop for ROOT's separate actual decision. No activation command was issued.
