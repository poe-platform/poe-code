# Exact public enum register receipts

The central map now links 726 additional bounded SDK receipts: 698 numeric
members, 15 action-object members and 13 definition aliases. Its full denominator
remains 2,409 inventory records / 2,426 target rows. At this checkpoint, the map
partitions into 738 bounded receipts, 10 confirmed unsupported and 1,678 not
currently reconciled rows. These counts are accounting, not full-member or CLI
coverage. The later layout and hyperlink work has separate receipts.

The original fixed literal arrays in `public-enum-values.test.ts` independently
assert exact numeric values, canonical frozen name/value metadata and 575 exact
XML conversion cases, plus all 15 immutable action name/value objects.
`public-enums.test.ts` asserts the 13 exact frozen alias identities and additional
input/immutability rules. Both now import definitions through the public
`index.ts`; expected tables and assertions are unchanged. The third test file,
`public-value-exports.test.ts`, preserves its existing public-value smoke checks.

The TypeScript parser was used to compare original literal rows against exact
central-map source IDs/values/tokens and alias targets. All 698 numeric rows, all
15 actions and all 13 alias targets matched with zero value/XML mismatches.
[The exact case map](enum-public-register-case-map.json) records every receipt
and original literal, with a matching XML-conversion row where present. Existing
planned acceptance cases remain in the central register; none was silently
replaced by a narrower denominator.

Three `PROG_ID` application rows stay unreconciled. Existing tests sample one or
more properties of those objects, which does not establish their complete
metadata surface. Likewise enum helper protocols/types and consumer APIs are not
blanket-promoted from these member tests.

JavaScript mappings remain explicit:

- Numeric symbols remain primitive numbers. `definition.metadata(value)` returns
  frozen canonical name/value and optional XML metadata; primitive numbers do
  not acquire `.name`. Equal-valued symbols remain addressable, while metadata
  and duplicate XML tokens canonicalize to the first declared value.
- Action values are immutable `{ name, value }` objects. Symbols naming file,
  program or macro actions do not execute those actions or grant capabilities.
- Aliases reference the same frozen definition. Empty or return-only XML tokens
  map to null metadata and conversion rejection. Zero values remain valid where
  their exact token is supported. Original PERCENT_40/SLIDE_IMAGE reconciliation
  remains intact; no new typo alias is introduced.

CLI boundary: a direct `schema values --json` probe returned exit 2 with the
versioned `invalid-value` usage error. The historical proposed generic enum
metadata routes are therefore retained under `proposed_cli`, and these rows have
no asserted complete `cli` route. Existing consumer schemas accept their bounded
enum subsets; that is different from generic enum discovery, and was not used to
certify all 726 rows. In particular all chart inspection symbols being exported
does not imply that every chart type can be created. `full_member_closure` and
full-public-API coverage remain false for every row in this receipt.

Validation: three public enum/value suites passed all 1,320 tests (the literal
suite contains 1,288 cases); focused ESLint passed. The integration owner runs the
maintained package checks. No publisher fixture, external runtime, host data or
network was used; the original independent test expectations were preserved.

Final check: consolidated each strengthened file to one public index import,
with all original literal/behavior assertions preserved; the three suites again
passed 1,320 cases and scoped ESLint passed. The integration owner also reported
6,871 maintained package cases, passing package lint/build, 16 final focused
cases and 239 safe-bash integration cases. The smaller final enum check verifies
the test-only import cleanup; no broad package rerun was necessary.
