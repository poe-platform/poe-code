# Comparison command limit evidence

Date: 2026-09-13. This is a bounded common-contract correction, not whole API or
cross-format conformance certification.

The common CLI contract requires explicit limit overrides to lower trusted host
ceilings. Ordinary commands already considered XML and optional validation
ceilings. Comparison considered only archive/read ceilings for bytes and only
XML ceilings for nodes/depth. It also failed to forward lowered byte limits to
XML parsing. Public command flags therefore had inconsistent meanings.

## Original red/green cases

`packages/pptx/src/command-diff.test.ts` uses original decks and memfs, with
explicit read/publication capabilities and no ambient product I/O.

| Case | Before correction | Correct behavior |
| --- | --- | --- |
| `maxBytes=8193`, trusted XML bytes 8192 | completed different, status 1 | status 2, invalid-value/usage, zero reads |
| `maxBytes=8192`, trusted validation bytes 8191 | completed different, status 1 | status 2, invalid-value/usage, zero reads |
| `maxNodes=1000`, trusted validation nodes 999 | completed different, status 1 | status 2, invalid-value/usage, zero reads |
| `maxDepth=32`, trusted validation depth 31 | completed different, status 1 | status 2, invalid-value/usage, zero reads |
| Compressed original repetitive text fits byte limit; expanded slide XML exceeds it | completed equal, status 0 | status 2, resource-limit, no publication |

The compressed case is authored through the package SDK and compressed through
its portable archive writer. It uses no downloaded or cloned fixtures. An early
test-construction attempt incorrectly supplied OPC slash-prefixed names to the
ZIP writer and was corrected before the meaningful red assertion was observed.

The fix stays inside the PPTX format package. The safe-bash adapter continues
calling the SDK command engine. No options, aliases, model spellings, schemas or
output-envelope fields were added. Comparison differences remain `ok: true`;
errors retain detailed codes and statuses 2/trouble or 130/cancelled.

Focused verification: command comparison and domain comparison suites pass,
26 original cases total. The existing cases cover equality, difference, missing
and invalid input, unsupported mode, unknown/inapplicable output flags, repeated
scalar flags, schema discovery, cancellation and bounded output.

Maintained root verification passed 261 PPTX test files and 6,837 tests. That
run included the 17 command-comparison cases before the compressed XML case was
added; the later 26-case focused run includes all 18 command and eight domain
comparison cases. The selected PPTX build closure passed all three workspaces.
Final `npm run lint --workspace=pptx` passed ESLint, production TypeScript and
test TypeScript checks after the compressed regression was added and formatted.

## Accounting and limitations

The required API/test audits and inventories were reviewed as historical evidence,
not current conformance claims. No inherited, underscore-prefixed public type,
enum, collection, helper or API lacking source tests was excluded by this work.
Existing JavaScript language/security mappings remain unchanged: explicit
capability I/O, async operations, neutral errors and equality represented as data.
No model API rows were implemented by this command-limit correction.

The root inventory review found 2,409 API inventory identities represented by
2,426 target rows, all 3,673 test identities retained (2,700 unit and 973 BDD),
and 22 underscore-prefixed public types retained. These are accounting results,
not assertions that all behaviors are implemented.

DOCX has a declared contract delegating to `office-cli.md` and `office-sdk.md`,
but no available package, public adapter or executable schema. Its runtime and
executable-schema halves remain pending; declarative agreement is not paired
success. [Adapter contract QA](adapter-contract-qa-20260913.md) records public
PPTX transport verification.
