# Indexed-array foundation investigation — 2026-08-28

**Design only; no product GO.** No product, native, oracle, comparator, test,
parser, arithmetic, or XAN execution occurred. Sources were read, not imported.
Alias/dotglob packets, the ratified 3771 profile and deliberate wildcard-dotdot
correction remain unchanged; neither implies implementation authorization.

## Accepted binding, not mixed HEAD

The published ledger at `docs/PROJECT_LEDGER.md:3005` accepts LET
`c26892c3a1a419311c9cf46a6c2976e696e00624` through independent
`08b0553148afdfdb95edd722a2cdd7f63935d470`. Its final-review/HANDOFF.md binds
accepted CD `4641075df5355a91c83bf5b2cc3a88dfaf1f5153`, 265 selected inputs
(5137 base, two ca1d WebDAV blobs, CD+LET runtime), and full846 package
`21c4858e6e4b857cd5e0d526159667621bcd206b4f1fd1ce1f84b54ad7abbace`.
This is accepted scoped composition, not a whole Git archive or current gate.
Original LET 81/84 and three versioned checks remain distinct; set-u remains
unsupported. These are published outcomes, not fresh results.

`SOURCE-BINDING.json` pins full revisions/hashes and receipts. Runtime was read
from the accepted LET blob; other shell files from the selected 5137 blobs.
Live runtime and shell.ts differ: directory-stack changes are author-only under
independent review (ledger:3075), not accepted. A future root must name the exact
integration composition and its consumer inventory; neither live HEAD nor this
design certifies it. No ambiguity prevents reading the accepted shell subset.

## Actual source obstacles

Anchors refer to those immutable revisions, not live line numbers:

- `runtime.ts:160,167,278,794`: saved bindings and variables are strings;
  clone/restore, readonly and arithmetic proxies have no element identity.
- `runtime.ts:1270`: assignment recognition is bare `name=` only.
  `parser.ts:274,439,573`: parentheses delimit words/groups; parameter AST has
  no subscript. Compound/indexed assignments need grammar, not argv rewriting.
- `arithmetic.ts:54,170`: bracket tokens/lvalues are unsupported; evaluation is
  synchronous signed-64-bit with 10,000 steps and depth/indirection limits.
- `runtime.ts:2330,2358,2465,2508,2658`: declaration/unset are scalar;
  quoted positional-at machinery exists but no indexed expansion. Readonly-a
  refuses; local-a is an invalid identifier. Declare/typeset/mapfile/readarray
  are absent from builtin discovery, not promised command availability.

## Recommendation and blockers

Adopt a real typed scalar/indexed binding with sparse storage, element-zero
compatibility, implicit assignment, compound replacement/append, quoted element
and aggregate expansion, lengths, deletion, and complete scope restoration.
Keep declare-a/typeset-a and mapfile/readarray separate later stages. The compact
`PROFILE.md` distinguishes official GNU Bash 5.3 facts, inspected source facts,
and proposed restrictions; it includes all seven requested manual URLs.

Recommend first indices be literal `0` or nonzero-leading decimal integers
through 2147483647: quoted literal digits allowed, no arithmetic/negative indices.
This deliberate Bash gap avoids changing accepted LET or evaluating indices
twice. Root must approve the domain, array-prefix refusal, aggregate-state
accounting, compound failure visibility, and declaration attribute timing.

Persistent array storage is not bounded by today's per-word expansion checks.
Require shared admission for retained strings, sparse metadata, saved/cloned
bindings and emitted fields before allocation; distinguish index ceiling,
element count and bytes. No new public options or RSS guarantee is implied.
Keep scriptFile whole-preflight and existing source/eval sequencing intact.

Later mapfile must use the parent-state mutator and borrowed input cursor, not
a registry stub. Freeze delimiter/EOF/read-ahead and partial-error behavior only
after foundation review. A different reviewer needs an authorized immutable
candidate, explicit profile decisions, unchanged scalar/CD+LET regression
inputs, and newly authorized syntax/scope/budget/cancellation evidence before
any acceptance. The execution hold remains in force.
