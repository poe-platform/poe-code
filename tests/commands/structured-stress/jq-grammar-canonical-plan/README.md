# Corrected jq canonical proposal v3 — NOT APPLIED

This leaf owns only this new directory. Read [PROPOSAL.md](PROPOSAL.md) before
reviewing either patch. No source, canonical test, old fixture, or old report was
changed. No product module was imported, no dependency installed, no delegation
performed, and no source or whole-product pass is claimed.

- **Native patch:** `native-v3.patch`, 29 selected named tests, two explicit
  opt-in byte-helper adjustments, and three new test-only expectation/assertion files.
- **Conditional host patch:** `host-conditional-v3.patch`, one JqError sink
  identity assertion. It is NOT a native delta and awaits the source reviewer's
  contract decision. Its existing EPIPE control is retained.
- **Authoritative map:** `row-map-final-v3.json` (29 rows),
  `host-row-v3.json` (one separate host row), `proof-links-v3.json` and
  `invocation-schedules-v3.json` (all 464 selected original/proposed invocations).
  `row-map-v3.json` is the earlier audit-derived capture input, not the final
  naming authority; the final map corrects the mixed resource test's name.
- **Handoff:** `handoff-v3.json` pins exact paths and SHA-256 values;
  `patch-manifest-v3.json` pins every original, full proposed-after snapshot,
  all 36 nonoverlapping edit spans, and unchanged byte ranges.
- **Validation:** `verification-v3-final.json` records proposal-only checks,
  including all 14 documented byte mutants rejected by the actual proposed
  callbacks. Frozen tuples injected into test code are NOT product execution.

## Safe reviewer checks, from repository root

`node tests/commands/structured-stress/jq-grammar-canonical-plan/verify.mjs`

`git apply --check tests/commands/structured-stress/jq-grammar-canonical-plan/native-v3.patch`

`git apply --check tests/commands/structured-stress/jq-grammar-canonical-plan/host-conditional-v3.patch`

`(cd tests/commands/structured-stress/jq-grammar-canonical-plan && shasum -a 256 -c MANIFEST.sha256)`

These do not apply the patches. Existing local TypeScript tooling is used only
for in-memory transpilation/typechecking; no emitted build or product import.
Do not rerun capture/generation scripts into their frozen output paths. They
refuse overwrite. A subsequent capture needs separately reviewed new paths.

## Open gates

Native capture reran 88 exact-input cases twice: 178 processes including version
and build queries. All captured tuples match the immutable expectations. The
two `file-unicode` cases could NOT be rerun as literal paths: the author's
immutable `native-files/` contains no `unicode-start` and no file with bytes
`f09f`. Inventory, raw bytes, provenance and before/after namespace/content
hashes are recorded. No new binary fixture, fd substitution, or literal-path
claim was made. **That native gate remains open.** Independent patch/helper
approval and separate source acceptance also remain open; only the source
reviewer can resolve the conditional host contract. Do not apply either patch
without explicit authorization. Do not call canonical tests green.
