# CommonMark reader completion evidence

The built-in `commonmark` reader now implements the advertised CommonMark
0.31.2 block and inline profile. Conversion logic remains in `packages/pandoc`;
the existing thin safe-bash inspection adapter derives availability from the
registry. CommonMark writing, GFM extensions and a full conversion command are
separate tasks and remain unavailable. No native fallback or Markdown parser
implementation is imported.

## Implementation and ceilings

Block discovery precedes inline resolution. The first definition for a label
after Unicode full case folding and ASCII space/tab/line-ending normalization
wins. Definitions remain scoped to one input, including during multi-input
conversion. Destinations and titles are decoded once, after structural parsing.
Images retain targets and structured alt content without fetching resources.

Linked delimiter and bracket stacks implement flanking, strong/emphasis run
consumption, rule-of-three exclusions, grouping boundaries and forbidden nested
links. Failed delimiter searches retain opener lower bounds by marker, closer
openness and run modulo. Backtick runs are indexed once by exact length, with
advancing positions; escaped partial runs with no indexed match remain text.
Every input/search loop is subject to work checkpoints. Work/retention/node and
reference capacity, nesting depth and entity expansion are bounded through the
shared execution context; asynchronous stages cooperate with cancellation.
Text fragments are joined on flush rather than repeatedly concatenating an
ever-growing string. Output Space nodes reserve capacity before allocation.

Unicode P/S and Zs classification uses binary searches over static Unicode
17.0.0 ranges; there are no parser regexes. The source data is
https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedGeneralCategory.txt,
SHA-256 `d62e5bab70ca74f099343f71224fa051cb1fdd61a1ab45c0488c44cfc0b6102e`.
The derived table includes Unicode License V3. Existing Unicode 17.0.0 full
case-fold data continues to supply label identity. The BSD-2-Clause `entities`
6.0.1 dependency supplies only named HTML entity lookup on bounded,
semicolon-terminated candidates; numeric references use the execution context.

## Failing-first original tests

The initial maintained workspace run failed on the absent inline module.
Handwritten expected ASTs cover delimiter runs/rule-of-three interactions,
intraword underscores, code-run mismatches and normalized spaces, literal
escapes/entities, balanced/escaped parentheses, empty targets, titles,
whitespace/case/Unicode labels, inline/full/collapsed/shortcut references,
unresolved reference fallback, image/link nesting, inner-link precedence,
angle URI/email autolinks, punctuation, raw HTML and hard/soft breaks.

Additional original cases failed before fixes for repeated spaces/tabs, URI
bracket encoding, CommonMark 0.31.2 comment grammar, form-feed label/target
distinctions, null-byte replacement, inline text ceilings, generated Space-node
capacity/retention, duplicate pre-discovered definitions and escaped partial
backtick runs. The latter reproduced a TypeError before falling back to text.
Original block regressions failed for indented blank-line spaces, ordered-list
delimiter changes, blank endings in nested quotes, and null code content. The
new Unicode classification suite failed on its missing module before the range
table was implemented.

An initial expected title for a quoted bare destination was corrected by
independently reading CommonMark's Links section: a quoted string is a
destination when it can be parsed as one. Empty-angle destination plus title
is tested separately. The original whitespace-opener case was also moved
away from the start of a line, where it is a block list marker.

Original unit tests import no downloaded fixture payloads and perform no
filesystem mutations, LLM requests or external executions. No memfs harness
is needed because these cases only construct strings and ASTs in memory.

## Separate licensed conformance lane

`npm run test:conformance --workspace=@poe-code/pandoc` first executes the
maintained selected workspace build closure, then checks all 652 normative
CommonMark 0.31.2 examples. Corpus SHA-256 and contiguous example IDs are pinned;
every mismatch or unmapped AST constructor fails. The newly authored HTML
projection interprets typed AST nodes only and is not a production writer or
a Markdown reader/writer round-trip oracle. There are no skip lists.

The normative corpus is separate CC-BY-SA-4.0 data, attributed with complete
license text in `commonmark-conformance-license.md`. It is not discovered by
workspace or root unit-test globbing, and this lane fetches nothing at runtime.
Original TypeScript code/tests remain repository code under MIT.

The first candidate matched 634/652. Seven discrepancies were projection-only
newlines between tight-list blocks (examples 9, 294, 296, 307, 319, 321, 323).
Original tests independently validated and fixed the eleven parser discrepancies:
tabs/spaces (13, 304, 652), block cases (112, 302, 320), URI encoding
(526, 538, 603), and raw comments (625, 626). Early compiler errors and a
mistyped corpus hash were corrected before the final successful maintained
build/conformance run. **Final result: 652 passed, zero failures in every block
and inline section.** Per-section counts are retained in
`commonmark-conformance-result.json`; no unresolved discrepancy is excluded.

`commonmark-markdown-applicability.json` maps all 153 inventoried upstream
Markdown reader cases at Pandoc commit
`c9a9a5eed7185783b69043e019c067370dc09615`: 48 re-derived core behaviors, 10
different expected trees, 92 extension-only cases and 3 mixed citation/link
cases. Source groups were read independently; only locators and applicability
metadata are retained. In particular, Pandoc's outer-link preference,
triple-emphasis constructor ordering, HTML segmentation, auto heading IDs,
bare URIs, wiki links and smart/attribute/note/citation syntax do not establish
CommonMark expectations. Coverage locators identify behavior families, not
execution of the upstream GPL test payloads. No Pandoc Markdown dialect gate
or native comparison is claimed.

## Maintained verification and visual QA

- `npm run test --workspace=@poe-code/pandoc`: 9 files, 427 tests passed,
  including 76 inline, 117 block and 28 Unicode cases. Final inline suite 36 ms.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint on source and conformance
  lane, source typecheck and test typecheck passed.
- `npm run test:conformance --workspace=@poe-code/pandoc`: maintained selected
  workspace build closure passed (one Pandoc build), then 652/652 examples passed.
- `git diff --check`: passed.

The maintained screenshot route captured the built SDK inspection adapter's
input/output listing; the inspected image `commonmark-formats.png` shows
CommonMark and JSON inputs and only JSON output. This is adapter listing QA,
not a claim that a new default safe-bash command or root CLI was installed.
No UI language, README, unrelated plan, workflow or other workspace was edited.
No full repository gate, remote delivery or release is claimed.

Verified source SHA-256:

- reader: `8725dc18e41374edf274c615533699fb26dc3174952c7cffe6cde3fc8289d16c`
- blocks: `e6f81633a47183d55f057f97abbc8a65e92c112caf8aa87b16720d882c88daf4`
- inlines: `dff8e5de87833bb617a12207014694cae11d5f9d06b1126f8201f3ecf7528945`
- syntax: `d2fc5b23506360cb80902f3a7a35a096929dc54d1f5dbc502c9500e67b34354e`
- characters: `82149be6fb0dc787f6ceb8b643d0da8e9c9caed484f1c3a4e5a0021cb63c31aa`
- inline tests: `be60fb6fec66a614b74b2e06cd1bbce54cf7b319eb5ab89b905ba738b5e403be`
- conformance lane: `acd7ec2fa33b851b5717b6330bb15fa1914e2933a4f1dac31edbdd672e1a3144`

Delivery: one verified atomic CommonMark-reader improvement is committed locally
on main with a Conventional Commit. No push or release was authorized or performed.
