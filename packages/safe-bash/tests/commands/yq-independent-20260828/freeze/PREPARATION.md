# Preparation record — 2026-08-28

Scope: independent data-only initial freeze, not a product/replay result.

## Checks and outcomes

- Static Git authentication: six sealed profile files match their exact commits
  and SHA-256 values; all ten final-contract baseline blob references match
  `5137a74ec855a32d8a8860eb66b62eb44d11e290`. Selected manifest binds 20
  artifacts, including historical DESIGN and unaccepted length candidate.
- First preparation-check attempt failed in the new checker itself: its local
  filename allow-list incorrectly rejected uppercase `README.md`. No product
  loaded or ran. The checker was corrected to permit ASCII uppercase local
  filenames, retaining separator/traversal refusal, before the initial seal.
- Corrected preparation check succeeded: 194 records / 13 categories; six
  explicitly partial blockers; 54 exact catalogue bindings; eight bounded
  recipe inputs; 26 reconstructed chunk partitions; three in-memory integrity
  negative controls. These are preparation counts, never product passes.
- The write-spec structural checker accepted `freeze/README.md` with zero
  warnings. Its use checks evidence-document structure, not product authority.
- No runtime dependencies were added. No YAML parser, native/reference oracle,
  command handler, query engine, npm build/test/typecheck, private checkout,
  package export or production source executed or changed.

## Remaining prerequisites

All 194 records still require authorized product replay. Six unresolved portions
are enumerated in `README.md`; the other records are frozen future assertions,
not accepted implementation behavior. The normative/query-budget reviewers'
sealed findings, separate length acceptance, exact candidate authentication,
approved internal observation and real public/adapter evidence remain pending.

No execution duration, full completion, YAML conformance, parity, superiority,
service acceptance or performance result is claimed. Product executions: **0**.
Native/reference executions: **0**. Original just-bash positive evidence is not
a comparator cohort. This initial packet does not authorize code or replay.
