# Preparation check record — 2026-08-28

This records preparation-tool outcomes, not product execution or conformance.
All commands ran from `/Users/kjopek/Workspace/safe-bash`.

1. Initial JSON load/count: 80 records; 34 document, 32 failure, four blocked,
   one Decimal, nine information expectations. Only JSON was parsed.
2. First `node .../normative/check-static.mjs` attempt failed on the reviewer's
   unjustified assumption that fixed source 5137 is an ancestor of inspected
   HEAD 16c4502d. Git returned status 1 for that ancestry check. This was an
   own-checker defect, not a product or source-integrity failure; no YAML ran.
3. Exact Git metadata established 5137's tree
   `48e5ae39ce98e1c8e416bae77da40d88b75e1db5` and parent
   `284857d7aa9b0ee0df2b6fdd1a71f41115d7b909`. The manifest now records non-ancestry,
   while retaining the authenticated numeric file and explicit adopted binding.
   Historical authority ancestry is checked separately, not waived.
4. Corrected static validator returned `PREPARATION_ONLY_OK` at HEAD
   `3bc2ee8aa38e82773a1fbec1f0b67673b0928105`: eight authenticated selected files,
   80 records, four blocked choices, 54 unique catalogue entries, nine information
   forms, fixed help/version hashes, and no selected current-file differences.
   It wrote no files and executed no product, native oracle, or YAML parser.
5. The write-spec bundled `check_spec.py` accepted `REVIEW.md` with zero warnings.
   This is a structural audit-document check, not an authority/conformance test.
6. Final repetition of both preparation checks returned the same successful
   results at 3bc2ee8a, and `node --check .../normative/check-static.mjs` succeeded.
   No product test or build was substituted for these preparation-only checks.

No tests, lint, build, native utilities, reference yq, or package code were run
as product validation. Git, the own JSON/byte checker, and the skill's Markdown
checker are preparation tooling. No canonical command rewrites this record.
