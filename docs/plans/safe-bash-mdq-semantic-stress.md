# Independently qualify mdq semantics

This is an agent-executed QA plan, not an automated QA script. Native processes
and generated evidence belong under the checkout's ignored `out/mdq-semantics`;
fast regression tests use memory only. Do not add the oracle to runtime code.

## Establish identity

1. Fetch main, record `git rev-parse HEAD`, Node version, OS/architecture, and the
   worktree's uncommitted changes. Install isolated dependencies with
   `npm run install:isolated -- --ignore-scripts`. Build the maintained mdq and
   safe-bash workspace closures if their public entry points need artifacts.
2. Obtain native `mdq` v0.10.0 (yshavit/mdq source
   `c4eccd0e340ad32f966ee8675c093dabe1005ee0`). Record its `--version`, SHA256,
   acquisition provenance and platform. Run it directly with argument arrays,
   stdin bytes and a timeout; never invoke it through an interpolated host shell.
   An unavailable oracle blocks completion. Keep the binary in `out`.
3. Read the command README and implementation plan's contract inventory.
   Markdown normalization, unordered JSON object keys, platform input-error
   details and the two documented upstream Unicode replacement panics require
   explicit classification; never discard arbitrary whitespace or diagnostics.

## Compare real entry points

For every case record ID, Markdown bytes, argv, file contents, output bytes,
error bytes, status, candidate revision and oracle identity. Compare Markdown
and plain stdout byte-for-byte, JSON structurally (preserving array order),
stderr byte-for-byte and status exactly. Also check JSON's no-final-newline
contract. Native file operands must have the same relative names/content as VFS
operands. Native missing-file diagnostics are platform-specific: preserve the
full raw results and compare the named path, error category and nonzero status.

Execute through the actual public Shell with an in-memory filesystem and
`agentCommands()` (including mdq). Use direct stdin, quoted VFS filenames, stdin redirection, and
`cat ... | mdq ...` pipelines. Exercise single-quote escaping in query strings.
Register a temporary Shell command invoking public `mdq(context, options)` to
compare SDK `argv` and typed options with the same native result. Cover ordered
multiple files, repeated files, mixed `-` operands, missing files and directories.
Check section boundaries and selection order using repeated nested headings.

## Independent corpus

Cross the following documents with identity, section, paragraph, list, quote,
link, image, code, table, front-matter and HTML selectors, in Markdown and JSON.
Use plain output and quiet mode for representative matches and no matches.

- ATX levels 1–6, Setext levels 1–2, duplicate and empty headings, skipped levels,
  nested sections and trailing heading markers.
- Heading-like text in fenced and indented code, blockquotes, nested ordered and
  unordered lists, escaped markers and malformed/unclosed constructs.
- Composed/decomposed Unicode, emoji, non-Latin case pairs, BOM, CRLF, missing
  final newline, empty/whitespace-only documents and punctuation-only Markdown.
- Inline/reference links, images, autolinks, duplicate/unused reference
  definitions, footnotes, aligned tables, task states, YAML/TOML front matter,
  HTML, thematic breaks, entities and inline formatting.

Cross selectors with bare versus single/double-quoted matchers, case differences,
anchors, regex alternation/classes/Unicode/repetitions, substitutions and pipes.
Include invalid syntax and regexes, absent selections, and substitution boundaries.

Generate 64 small documents using unsigned xorshift32 seed `0x1907cafe`:
`x ^= x << 13; x ^= x >>> 17; x ^= x << 5`, unsigned after each draw.
For each document draw eight blocks from the corpus block list in the durable
results record. Preserve seed, block list, generation order and failing inputs.
Cross generated documents with section/paragraph selectors and Markdown/JSON.
Keep this opt-in native exercise separate from the fast unit suite.

## Option and error inventory

Exercise both spellings where available, all enumerated values, and invalid or
missing values: `-o/--output markdown|md|json|plain`, `-l/--link-format
keep|inline|never-inline`, `--link-pos section|doc`, `--footnote-pos section|doc`,
`--renumber-footnotes true|false`, `--wrap-width`, `-q/--quiet`, `--br`, `--no-br`,
`-h/--help`, `-V/--version`, `--allow-unknown-markdown`, and `--`.
Include combined/repeated flags, JSON plus wrapping, unknown flags, malformed
queries, no matches, invalid UTF-8 input and file failures. Distinguish native
parser behavior from safe-bash's documented host/resource contract. Keep limits
at their defaults for semantic comparisons; enforce an external native timeout.

## Triage immediately, then continue

For each mismatch, rerun it in isolation, remove irrelevant blocks/options, and
recheck current main. Check oracle nondeterminism and harness quoting/input
mistakes first. Search internal issue tracking for an existing report. Immediately
file each distinct validated defect as open, unassigned and non-draft, labeled
`safe-bash` and `mdq`, linked to the implementation and this audit. Include exact
repro input/query, expected/actual streams and status, revisions, environment,
limits, severity and focused acceptance criteria. Do not block pickup on this
audit, and do not close unresolved defects when completing it.

## Verify and deliver

Preserve independent successful oracle cases as literal memory-backed tests;
use existing command context helpers where practical. Run scoped command tests
and lint/typecheck. No CLI presentation changes are intended; if one is made,
inspect an actual CLI screenshot too. Record the complete inventory, counts of
passes/mismatches/unavailable checks, each classification and minimized repros
in durable internal issue content before removing temporary output. Commit the
plan and regressions, rebase on current remote main, push and verify ancestry on
remote main. Record local commit, remote delivery and release separately. Close
only after every audit requirement is verified; purge temporary output and the
worktree after delivery. Release completion is not a gate for this audit.
