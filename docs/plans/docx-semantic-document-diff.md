# Bounded semantic document comparison

Owned task: `semantic-document-diff`. Later extraction, packing, validation and
whole-model qualification tasks remain pending. Work stays on main, with one
owned feature commit and no push or release. Existing unrelated plans and OMML
work remain untouched.

## Contract and language/security mapping

`compareDocument(left, right, context, options)` is an always-async original
utility API accepting two `Uint8Array` inputs, explicit archive ceilings,
cancellation and an optional shared `DocumentBudget`. The direct CLI operation
is `diff LEFT RIGHT --scope SCOPE [--mode MODE] [--json] [--limit NAME=VALUE]`.
Both surfaces validate the same closed operation schema. Only one CLI input may
consume stdin; paths and streams require supplied filesystem authority.

There is no exact diff member in the pinned public object-model inventory.
Comparison is additive F48 behavior, not implementation of Document, Package,
OpcPackage, Part, XmlPart or inherited `.part`/`.element` members. All 920
historical inventory records, including 12 publicly documented underscore-prefixed
types, 410 planned, 378 security-mapped, 124 language-mapped and eight
documentation-error records retain their dispositions. Collections, enums,
helpers, inherited and prose-only APIs remain visible and pending where already
pending. Neutral model spellings are unchanged; no dynamic model invocation,
host paths, native reference runtime, ambient timestamps or networking is added.
No downloaded assets or derived source are used.

Options map mechanically between `--mode`/`mode`, `--scope`/`scope`, `--json`/`json`
and `--limit`/`limit`. Missing scope and incompatible mode/scope are usage errors
before input acquisition. Default mode is `parts`; there is no default scope.

- `parts`, scope `package`: compare every non-directory uncompressed member,
  including content types, relationships, opaque data and media. ZIP compression,
  order, timestamps, comments and other container metadata do not affect equality.
- `xml`, scope `package`: compare expanded element/attribute names with sorted
  attributes and ordered content. Adjacent text and CDATA have the same character
  semantics. Preserve whitespace, child order, comments, processing instructions,
  values and arbitrary identifiers. Known MCE namespace/QName lists and standard
  `xsi:type` values resolve against each element's bindings; arbitrary attribute
  strings are never rewritten. Non-XML parts retain exact byte comparison.
- `text`, explicit body/headers/footers/footnotes/endnotes/comments/text-boxes or
  all-stories scope: compare final logical story text using the existing traversal,
  including paragraph, cell, row and story ownership boundaries. Run splitting
  and formatting alone do not change text equality. This is not rendered text.
- `structure`, the same story scopes: compare ordered stored semantic story XML,
  collapsing plain word run/text wrappers while retaining formatting, table grids,
  properties, annotations, identifiers and opaque content. Include referenced
  image payloads. Nested text-box bodies are separate stories, excluded from their
  enclosing story's content comparison. No ID renumbering, layout calculation or
  general document alignment algorithm is introduced.

Successful SDK comparisons return `{equal, mode, differences}` and never throw
merely because inputs differ. Differences are deterministic part-level
add/remove/change records with source-SHA-256-bound locations (null on the absent
side); no document excerpts enter diagnostics. The CLI uses the version-one
result envelope and statuses 0 equal, 1 different, 2 trouble. Cancellation remains
an explicit propagated cancellation, reserved as 130 by the shared CLI contract. The existing Shell root-signal
policy rejects with the supplied abort reason instead of resolving a buffered
result; comparison preserves that cancellation authority. Detailed stable
usage/container/XML/package/resource/I/O categories are retained independently
of the comparison exit status.

Both packages are admitted even when equal or when a logical scope is empty.
Compressed/expanded/entry ceilings remain per document; retained bytes, XML nodes,
work and differences are cumulative. The existing `matches` ceiling bounds
returned changes; exhaustion fails instead of returning a truncated equality
claim. Traversal has bounded XML depth and nodes; canonical token construction
joins character chunks and story arrays once, avoiding recursive string escaping
or quadratic concatenation. Parsing/indexing, retained canonical values and
comparison work are charged to the shared budget, with cooperative checkpoints.
Accounting is conservative and does not promise process RSS isolation.

## Original regressions and red evidence

`packages/docx/src/diff.test.ts` uses original admitted packages and memfs for
filesystem state. Initial six cases failed before code because the public SDK
comparison was absent and CLI scope unsupported. Follow-up failing cases exposed
missing discovery, nested text-box scope leakage, lexical QName comparison and
mode/scope validation after acquisition and a misleading inherited help scope footer; each was corrected after red evidence.
Invalid test assumptions (annotation story location and missing content-type
registration for an added original part) were repaired without product changes.

Cases cover store/deflate repacks and reversed member order/dates/comments,
unchanged left and right bytes/files, attribute order/prefix spelling,
CDATA/character data, whitespace/order/values/relationship IDs, images,
annotations, comment table grids, logical run splits, nested text boxes, standard
QName attributes, added/removed source-bound locations, explicit scope, stdin,
comparison exit codes, bounded changes and cumulative retention/input accounting.
No original test is removed or renamed. Historical inventory evidence is not
promoted by these utility tests.

## Agent-executed QA and maintained checks

1. Run the maintained selected build closure:
   `npm run build:workspaces -- --workspace=docx` (portable safe-fs dependency,
   without native reference or host-native codec fallback).
2. Run `npm test --workspace=docx` and `npm run lint --workspace=docx` against
   frozen owned source. The root unit runner does not accept `--workspace`;
   pass the selection to npm itself, using the declared workspace test lifecycle.
3. Through the built public DOCX SDK and existing explicit safe-bash plugin,
   inspect generated diff help/schema and equal/different/trouble workflows.
   Use the maintained `npm run screenshot` route to capture terminal output,
   then inspect the PNGs. DOCX is an injected plugin, not a default root command,
   so `screenshot-poe-code` would exercise unrelated root/predev behavior.
   Screenshots and logs are disposable QA evidence and are not staged.
4. Inspect owned diffs, stage each owned path explicitly, commit with a
   Conventional Commit without hook bypass or co-author, and report the local
   hash separately from delivery. Do not push or release.

Ad hoc 100-column PTY help and comparison result captures were inspected at
`/tmp/docx-diff-help.png` and `/tmp/docx-diff-result.png`. The built SDK and existing
explicit safe-bash plugin executed original VFS `.sh` workflows with quoted
filenames; statuses were 0 equal, 1 different and 2 invalid-container trouble.
The first result capture used TextDecoder on the Shell's already-decoded string;
it is discarded QA, corrected to the documented string result without product
changes. A cancellation probe confirmed the existing root-signal rejection policy
above (the initial probe overrode readFile while MemoryFileSystem used readStream;
only the corrected stream probe exercised cancellation).

Selected portable build closure passed, as did package lint/type/test-type checks
(one warning in untouched operation-types.test.ts) and the maintained root public
export/portable browser closure tests (two passes). Logs are disposable evidence:
`/tmp/docx-diff-final-build.log`, `/tmp/docx-diff-final-lint.log` and
`/tmp/docx-diff-public-check.log`. Final frozen workspace tests passed: 152 files / 3,075 tests, including all
15 original comparison regressions, in `/tmp/docx-diff-final-tests.log`.
The spec checker passed with no warnings. The preceding full run (3,074 tests)
is intermediate evidence before the help-footer regression. Only this task is
marked done in the master plan; its unrelated existing changes stay unstaged.
The owned feature commit records this plan and implementation together; its local
hash is reported to the user after commit verification. No push or release.
