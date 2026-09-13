# Animation inventory QA and delivery

Scope: F45 read-only timing inventory with F46 complex-timeline preservation.
No whole pipeline, push, release, README edits or native document runtime.

## Ownership

Root coordinates exports, QA and local commits. timing_domain owns new animation
domain files and the inventory implementation plan. timing_cli owns new command
and safe-bash tests, animation schema and animation-only command-engine hunks.
timing_research owns animation case accounting, schema research and usage draft.
Existing unrelated work remains untouched, including image/media edits.

## Procedure

1. Run original failing tests first, then domain and command implementation.
2. Run maintained pptx tests/lint/build closure and focused safe-bash checks.
3. Admit only manifest-listed cached decks after SHA-256 verification. Compare
   inventory graph totals against independently parsed slide timing XML, check
   deterministic repeated output and no input changes. No download dependency.
4. Inspect actual command help and selected inventory output with a terminal
   screenshot. This is ad hoc QA, never a screenshot unit test.
5. Reduce a meaningful corpus finding into an original bounded regression.
6. Stage only explicitly owned paths and animation hunks in shared files; commit
   locally on main after checks. Report commits separately from remote delivery.

## Evidence

Corpus read QA passed on three existing manifest entries after SHA-256 checks:

| Cached deck | Slides with timing | Timing XML elements | Motion paths |
| --- | ---: | ---: | ---: |
| CERN-intro-2025-v2.pptx | 4 | 471 | 1 |
| ISOLDE-drawings.pptx | 5 | 20 | 0 |
| slides-public-engagement-DEC-2021.pptx | 22 | 9,649 | 101 |

Counts were independently established with ZIP + namespace-aware XML parsing,
then asserted literally against SDK output. Repeated SDK inventories matched;
input hashes remained the manifest hashes; all three returned zero diagnostics.
No downloads or corpus writes occurred. Empty cTn trees lacking childTnLst are
present in the drawings corpus: the original parametrized regression retains
this structure without repair. Complex graphs include opaque iteration, build
lists and motion paths. No playback/rendering fidelity claim is made.

Whole model/API parity and timeline editing are not claimed.

The 13 SDK cases pass after a duplicate-ID/reference amplification regression
first failed: resolved destinations now consume a cumulative per-slide XML-node
budget. CLI help was captured with the maintained screenshot runner at
`/tmp/pptx-animation-help.png` and visually inspected: complete, legible, status 0.
The screenshot runner used the actual injected command engine because pptx is a
virtual shell utility, rather than a top-level poe-code subcommand.

Final maintained receipts:

- `npm run test --workspace=pptx`: 146 files, 3,906 tests passed. A prior run
  overlapping the XML-field implementation saw one missing-field failure; the
  final complete run passed. Two subsequent test-only additions passed in the
  focused suites (14 SDK and four command cases).
- `npm run lint --workspace=pptx`: ESLint and production/test TypeScript passed.
- `npm run build:workspaces -- --workspace=pptx`: declared three-workspace build
  closure passed. No root pipeline was executed.
- Focused actual safe-bash test passed with an original seven-node timeline,
  public SDK parity, virtual script/quoted filename, ambiguity and limits.
- Focused maintained discovery assertion passed, confirming the new adapter test
  belongs to the normal test runner.
- CLI corpus QA on the manifest intro deck slide 15 matched SDK order and the
  independent XML census: 68 nodes, one motion path, 135,012 JSON bytes, status 0.

Only animation hunks are staged in command-engine.ts, index.ts and the safe-bash
runner assertion file. All unrelated image/media work and corpus files remain
outside the commit. The upstream ledger retains 54 related cases and 48 API rows;
read observation does not claim video creation or whole live-model completion.

Final delivery audit: the focused 18-case run and final package lint passed after
the test-only additions. A TypeScript compiler check using the staged versions
of command-engine.ts and index.ts also passed, verifying isolated animation
integration independently of unrelated unstaged hunks. The focused safe-bash
TypeScript check passed; details are in pptx-animation-cli.md.
