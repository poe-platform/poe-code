# csvcut engine contract review

Review date: 2026-09-20. Reviewed the supplied working-tree candidate, including
`safe-bash-command-csvcut`, its shared `safe-bash-csv-engine` owner, the public
safe-bash facade and maintained isolated packaging controls. Existing unrelated
changes were preserved. The archived package-pattern document was used because
the requested original path is deleted in the supplied working tree.

## Validated findings and fixes

Original memory-only failing tests preceded each code fix:

- Dialect admission used UTF-16 length rather than Unicode scalar length.
  Supplementary delimiter, quote and escape characters were rejected. Admission
  now accepts one scalar and rejects isolated surrogates, multiple scalars,
  empty strings, CR, LF and NUL. Literal multiline/doubled-quote/escape fixtures
  run at every possible two-chunk byte split.
- Generated header counts silently accepted negative, fractional and NaN inputs;
  unbounded numeric inputs entered generation. Nonnegative safe integers are now
  required, with structured argument errors before allocation.
- Empty selection bypassed cancellation and disposed-ledger checks. Empty
  selection and zero generated headers now enter the same invocation ledger.
- Invalid budget limits and charges threw unstructured RangeErrors. Both now
  return `CsvError` with `code: "ARGUMENT"`; rejected charges leave accounting
  unchanged.
- Signed zero was parsed as a range under zero origin. Valid whole numeric
  positions now precede range parsing and return canonical zero. Literal
  inclusion/exclusion controls preserve repetitions and independently retain
  invalid negative-position fallback (`-2`) as an open range.
- A custom async iterator whose `next()` rejected never received `return()`.
  The record stream now owns the iterator and retires it once, including on
  rejected reads, EOF and consumer return. Falsey primary reasons survive both
  synchronous and asynchronous retirement failures. Retirement-only failures
  are reported, and parser/ledger disposal runs even when retirement fails.
  A separate failing ownership control required capturing `next()` once with
  its original receiver, preserving standard async-iteration behavior.

One private retirement helper enforces error precedence while the record stream
owns parser/ledger disposal. Shared parsing, selection and writing remain in one
engine; csvcut owns streaming lifecycle and safe-bash only exports it. No runtime dependency, host filesystem/executable,
network, download, native/WASM fallback or held XAN source was added. Pandoc's
document/AST parser and table-text's record helpers were inspected without
copying them. XAN admission declarations remain authoritative; held parser
payloads were not inspected or imported.

## Compatibility and ownership

The candidate compatibility identity remains csvkit 2.2.0 / agate 1.14.2 /
Python 3.9; strict-v1 remains an explicit isolation deviation, not Python CSV
strictness. No new quoting constants, encoding, inference, Sniffer, CLI flags or
later-source ignore-unknown behavior was admitted. Legacy selectors and release
range defects remain controlled independently. Full compatibility and command
behavior/wiring are subsequent acceptance tasks, not certified by this review.

Input is an explicit byte-producer capability. Producer reuse, early return,
malformed input, quotas, abort during cooperative pending reads, exact falsey
reasons and invocation disposal remain tested. Pending reads and retirement must
honor the supplied signal; arbitrary hostile host JavaScript is outside the
capability contract. Returned records belong to consumers. Retention is a
conservative cumulative allocation ledger, not a measurement of JS heap usage.

The command manifest remains ESM, `private: true`, with name
`safe-bash-command-csvcut` and no external runtime dependencies. Public runtime
and declaration consumers use `@poe-platform/safe-bash/commands/csvcut` after
private workspaces are removed from the isolated memfs artifact. No CLI command
or visual behavior changed, so screenshot validation is not applicable.

## Verification and unresolved acceptance

Passed after the code changes: shared engine tests (22), csvcut stream tests (11),
csvgrep tests (55), csvsort tests (21), selected maintained csvcut build closure,
and isolated packaging/private-bundle tests (158), including strict declaration
consumption. Native executable evidence was not used as a unit dependency or
newly claimed as manual qualification.

**Unresolved blocker:** `npm run typecheck --workspace=@poe-platform/safe-bash`
exits 2 before source/current-consumer checks: root `poe-code` lacks the required
public SafeFS export through `./packages/safe-js/dist/safe-fs.js`. The maintained
check reports “Public SafeFS must preserve shared SafeJS runtime identity,” with
actual `undefined`. The root publication manifest was not changed or its check
weakened. Isolated csvcut declarations pass independently, but broader acceptance
remains blocked by this finding.

Final shared-engine and csvcut workspace lint/type checks passed. Repository-wide
`npm run lint` passed after all fixes, including type contracts and workflow lint:
the completeness guard reported 16,135 configured/linted files, zero errors,
four warnings and no gaps. `git diff --check` passed.

The maintained `npm test` completed with exit 0, including workspace build/test
closure and native `posttest` lint-stress controls (2 passed). The safe-bash route
reported 41,909 passed and 829 skipped, with its independent runner reporting
563 passed; SafeJS reported 31,121 passed and 48 skipped; Safe Python reported
84,595 passed; Safe Playwright reported 34 passed; Terminal Pilot reported 293
passed. Skipped cases and workspaces without declared tests are not passes.
This run used the standard shared machine cache. Its CSV workspace phase preceded
the last ownership and signed-zero fixes; the final focused checks above cover
those changes. No fresh `--no-cache` qualification is claimed.

No local commit, remote-main delivery, release or publication was requested or
performed.
