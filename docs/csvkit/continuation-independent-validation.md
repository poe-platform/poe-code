# Independent composition validation, September 18, 2026

An independently assigned stress agent inspected the current `csvcut`,
`csvgrep`, `csvsort`, and `csvstack` source and source contracts, then authored
25 original Shell assertions in
`packages/safe-bash/tests/commands/csvkit-continuation-independent.test.ts`.
The expected supported behavior comes from inspected source contracts and
original inputs; these are not fresh frozen CPython differential observations.
The target archive/profile remain those recorded in `reference-profile.json`.

Thirteen supported cases cover repeated/excluded selectors and selected-cell
emptiness, zero-based generated headers, pipeline AND/OR/inversion semantics,
multiline substring matching, lexical numeric preservation, physical consumed
line numbering, stable reverse sorting of expanded Unicode uppercase keys,
codepoint ordering beyond UTF-16, Decimal values above JavaScript's safe integer
range, reverse null order with stable ties, lexical blank retention, duplicated
grouping-column collisions, blank versus one-empty-cell records, and named-input
partial output before surplus-field failure. Named contents live in memfs with
genuine VFS stat operations; exact retained source-file contents are asserted.
Actual parser/filter/query-free ordering and shell pipeline algorithms execute;
no canned engine responses, native programs, network or disk fixture generation
are used by canonical discovery.

Twelve additional assertions cover the exact explicit refusal of reader quoting
`-u 2`, `-u 4`, and `-u 5` for each of the four tools. They verify empty stdout,
the exact blocker diagnostic and status 78. These twelve are **blockers**, not
compatibility passes, despite passing the refusal assertions.

The first test run had two harness/expectation failures. The numbering test used
numeric `-c 2`, which intentionally addresses the second original column even
when `-l` prefixes the input rows; the test intended to search the `key` column
and was corrected to use its explicit name after inspecting the existing source.
The named-input harness removed `readStream` from a filesystem whose published
capability still advertised streams, causing a genuine VFS ENOTSUP refusal; it
was corrected to provide a memfs-backed stream. Neither validated a product
defect, so product source was left unchanged.

Focused verification:

- `TSX_DISABLE_CACHE=1 node --import tsx --test --test-reporter=dot packages/safe-bash/tests/commands/csvkit-continuation-independent.test.ts`
  passed all 25 assertions, with no skips/TODOs; the denominator is thirteen
  supported cases and twelve blocker-refusal cases.
- Maintained guarded discovery has an exact literal-path assertion for the new
  test, added by the root integration owner.
- `npm run test:runner --workspace=@poe-platform/safe-bash` passed 536 assertions
  with no failures, skips or TODOs, including guarded discovery membership.
- `npm run screenshot -- --output out/csvkit-continuation-independent-visual.png node out/csvkit-continuation-independent-visual.mjs`
  completed. The image was inspected: physical numbering and multiline quoting,
  reverse null/stable tie ordering, and duplicated grouping-column output were
  readable and matched the canonical expectations. Temporary renderer/image
  files were purged after reduction. No visual product changes were made.

Root owns lint, typecheck, build and broader integration verification. This
cohort does not qualify every common/local option, all fourteen tools, all
encodings/dialects, every selector/regex syntax, verbose Python frame identity,
transaction/database/network/interpreter contracts, cancellation/backpressure
exhaustion, large corpora or service campaigns. Accepted unsupported quoting
modes remain explicit parity blockers. No README, staging, commit, push or
publication was performed by this agent.
